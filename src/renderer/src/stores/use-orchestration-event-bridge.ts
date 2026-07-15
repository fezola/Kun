import { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chat-store'
import { useOrchestrationStore } from '../stores/orchestration-store'

/**
 * Bridges the chat store's SSE-streamed orchestration events into the
 * dedicated orchestration store. Call once at the app root or in any
 * top-level component that stays mounted for the session lifetime.
 */
export function useOrchestrationEventBridge(): void {
  const lastEvent = useChatStore((s) => s.lastOrchestrationEvent)
  const eventSeq = useChatStore((s) => s.orchestrationEventSeq)
  const applyEvent = useOrchestrationStore((s) => s.applyEvent)
  const appliedSeqRef = useRef(0)

  useEffect(() => {
    if (eventSeq <= appliedSeqRef.current) return
    if (!lastEvent) return
    appliedSeqRef.current = eventSeq
    applyEvent(lastEvent)
  }, [eventSeq, lastEvent, applyEvent])
}
