import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";

import { researchGraph, type ResearchChunk } from "./graph";
import { ACTION_RESULT_EVENT, USAGE_EVENT, type ActionResult, type ResearchRunProps, type ResearchState } from "./protocol";
import { createSearch } from "./search";

/** Stop a run just before the platform's function limit (maxDuration 300s) so the client gets a clear message. */
const RUN_TIME_LIMIT_MS = Number(process.env.RESEARCH_TIME_LIMIT_MS) || 285_000;
const MAX_QUESTION_CHARS = 500;

/** Nodes with a user action in flight (per server process): one action per node at a time. */
const activeNodes = new Set<string>();

/**
 * AG-UI agent that runs the LangGraph research workflow in-process and
 * translates its custom stream into AG-UI protocol events.
 */
export class ResearchAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const abort = new AbortController();
      const emit = (event: BaseEvent) => !subscriber.closed && subscriber.next(event);
      const { threadId, runId } = input;
      const props = (input.forwardedProps ?? {}) as Partial<ResearchRunProps>;
      const question = props.question?.trim().slice(0, MAX_QUESTION_CHARS) || "Untitled research question";
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, RUN_TIME_LIMIT_MS);
      const researchId = props.researchId ?? runId;
      const action = props.action;
      let ownsNode = false;

      let step: string | null = null;
      const enterStep = (name: string | null) => {
        if (step) emit({ type: EventType.STEP_FINISHED, stepName: step } as BaseEvent);
        step = name;
        if (step) emit({ type: EventType.STEP_STARTED, stepName: step } as BaseEvent);
      };

      const totals = { llmCost: 0, llmRequests: 0, credits: 0 };
      const toEvents = (chunk: ResearchChunk) => {
        switch (chunk.type) {
          case "graph":
            emit({ type: EventType.CUSTOM, name: chunk.event.name, value: chunk.event.value } as BaseEvent);
            return;
          case "phase":
            emit({ type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/phase", value: chunk.phase }] } as BaseEvent);
            enterStep(chunk.phase === "completed" ? null : chunk.phase);
            return;
          case "usage": {
            const u = chunk.usage;
            if (u.kind === "llm") {
              totals.llmCost += u.costUsd;
              totals.llmRequests++;
            } else totals.credits += u.credits;
            emit({ type: EventType.CUSTOM, name: USAGE_EVENT, value: u } as BaseEvent);
            return;
          }
          case "result": {
            if (!action) return;
            const value: ActionResult = {
              actionId: action.actionId,
              nodeId: action.target.id,
              kind: action.kind,
              message: chunk.message,
              added: chunk.added,
            };
            emit({ type: EventType.CUSTOM, name: ACTION_RESULT_EVENT, value } as BaseEvent);
            return;
          }
          case "branch":
            emit({
              type: EventType.STATE_DELTA,
              delta: [{ op: "add", path: `/branches/${chunk.branchId}`, value: { label: chunk.label, status: chunk.status } }],
            } as BaseEvent);
            return;
        }
      };

      (async () => {
        emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);
        if (action) {
          if (activeNodes.has(action.target.id)) throw new Error("An action is already running on this node.");
          activeNodes.add(action.target.id);
          ownsNode = true;
        } else {
          const initial: ResearchState = { researchId, question, phase: "planning", branches: {} };
          emit({ type: EventType.STATE_SNAPSHOT, snapshot: initial } as BaseEvent);
        }

        const stream = await researchGraph.stream(
          { researchId, question, action },
          {
            streamMode: "custom",
            signal: abort.signal,
            configurable: {
              search: createSearch(),
              knownSources: new Map(Object.entries(action?.knownSources ?? {})),
              sourceNodes: new Set(Object.values(action?.knownSources ?? {})),
            },
          },
        );
        for await (const chunk of stream) toEvents(chunk as ResearchChunk);

        enterStep(null);
        console.info(
          `[research] ${researchId}: ${totals.llmRequests} LLM requests ~$${totals.llmCost.toFixed(4)}, ` +
            `Firecrawl ~${totals.credits} credits`,
        );
        clearTimeout(deadline);
        emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
        subscriber.complete();
      })().catch((error: unknown) => {
        clearTimeout(deadline);
        if (timedOut) {
          if (!action)
            emit({ type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/phase", value: "error" }] } as BaseEvent);
          emit({
            type: EventType.RUN_ERROR,
            message: "Research stopped at the server time limit. Results received so far are kept on the board.",
          } as BaseEvent);
          return subscriber.complete();
        }
        if (abort.signal.aborted) return subscriber.complete();
        if (!action)
          emit({ type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/phase", value: "error" }] } as BaseEvent);
        emit({ type: EventType.RUN_ERROR, message: error instanceof Error ? error.message : String(error) } as BaseEvent);
        subscriber.complete();
      });

      return () => {
        clearTimeout(deadline);
        abort.abort();
        if (ownsNode) activeNodes.delete(action!.target.id);
      };
    });
  }
}
