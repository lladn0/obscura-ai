import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";

import { researchGraph, type ResearchChunk } from "./graph";
import type { ResearchRunProps, ResearchState } from "./protocol";
import { BranchScheduler } from "./scheduler";

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
      const question = props.question?.trim() || "Untitled research question";
      const researchId = props.researchId ?? runId;

      let step: string | null = null;
      const enterStep = (name: string | null) => {
        if (step) emit({ type: EventType.STEP_FINISHED, stepName: step } as BaseEvent);
        step = name;
        if (step) emit({ type: EventType.STEP_STARTED, stepName: step } as BaseEvent);
      };

      const toEvents = (chunk: ResearchChunk) => {
        switch (chunk.type) {
          case "graph":
            emit({ type: EventType.CUSTOM, name: chunk.event.name, value: chunk.event.value } as BaseEvent);
            return;
          case "phase":
            emit({ type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/phase", value: chunk.phase }] } as BaseEvent);
            enterStep(chunk.phase === "completed" ? null : chunk.phase);
            return;
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
        const initial: ResearchState = { researchId, question, phase: "planning", branches: {} };
        emit({ type: EventType.STATE_SNAPSHOT, snapshot: initial } as BaseEvent);

        const stream = await researchGraph.stream(
          { researchId, question },
          {
            streamMode: "custom",
            signal: abort.signal,
            configurable: { scheduler: new BranchScheduler(), sourceNodes: new Set<string>() },
          },
        );
        for await (const chunk of stream) toEvents(chunk as ResearchChunk);

        enterStep(null);
        emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
        subscriber.complete();
      })().catch((error: unknown) => {
        if (abort.signal.aborted) return subscriber.complete();
        emit({ type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/phase", value: "error" }] } as BaseEvent);
        emit({ type: EventType.RUN_ERROR, message: error instanceof Error ? error.message : String(error) } as BaseEvent);
        subscriber.complete();
      });

      return () => abort.abort();
    });
  }
}
