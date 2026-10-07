import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionToolExposure, VISION_TOOLKIT_ACTIVATE } from '../src/exposure.ts'
import { VISION_SKILLS_CONTENT, VISION_SKILLS_NAME } from '../src/skill.ts'

function restoredTools(events: unknown[], accessor: 'snapshotEvents' | 'events' = 'snapshotEvents'): string[] {
  const names: string[] = []
  const session = { id: 'fixture-session',
    ...(accessor === 'snapshotEvents'
      ? { snapshotEvents: () => events as SessionEvent[] }
      : { events }),
  } as unknown as Session
  const agent = { id: 'fixture-agent', session, ctx: { tools: {
    register: (definition: { name: string }) => {
      names.push(definition.name)
      return () => { names.splice(names.indexOf(definition.name), 1) }
    },
    restrict: (restriction: { deny: string[] }) => {
      expect(restriction.deny).toEqual([VISION_TOOLKIT_ACTIVATE])
      return () => {}
    },
  } } } as unknown as Agent
  const ctx = {
    on: () => () => {}, agents: { list: () => [agent] }, sessions: { get: () => undefined },
  } as unknown as Context
  const exposure = new VisionToolExposure(ctx, () => [defineTool({
    name: 'vision_glance', description: 'fixture tool', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    execute: () => Promise.resolve({}),
  })])
  const dispose = exposure.install()
  const restored = [...names]
  dispose()
  return restored
}

function nativeHistory(message: unknown, name = VISION_SKILLS_NAME, tool = 'skill'): unknown[] {
  return [
    { type: 'tool/call', data: { name: tool, callId: 'skill-call', arguments: JSON.stringify({ name }) } },
    { type: 'tool/result', data: { message } },
  ]
}

const rawResult = {
  role: 'tool', toolCallId: 'skill-call', isError: false,
  content: [{ type: 'text', text: VISION_SKILLS_CONTENT }],
}

describe('VisionToolExposure durable native Skill history', () => {
  it.each(['events', 'snapshotEvents'] as const)('R12 restores Host 0.2 raw tool results through %s', accessor => {
    expect(restoredTools(nativeHistory(rawResult), accessor)).toEqual(['vision_glance'])
  })

  it('preserves the legacy nested result contract', () => {
    const message = createToolResultMessage({
      callId: ToolCallId('skill-call'), isError: false,
      content: [{ type: 'text', text: VISION_SKILLS_CONTENT }],
    })
    expect(restoredTools(nativeHistory(message))).toEqual(['vision_glance'])
  })

  it.each([
    ['error', { ...rawResult, isError: true }],
    ['unknown success state', { ...rawResult, isError: undefined }],
    ['mismatched call', { ...rawResult, toolCallId: 'other-call' }],
    ['missing call', { ...rawResult, toolCallId: undefined }],
    ['unrelated content', { ...rawResult, content: [{ type: 'text', text: 'different skill body' }] }],
    ['not a tool message', { ...rawResult, role: 'user' }],
  ])('does not restore Host 0.2 activation from %s', (_label, message) => {
    expect(restoredTools(nativeHistory(message))).toEqual([])
  })

  it('requires the matching bundled Skill call before its result', () => {
    expect(restoredTools(nativeHistory(rawResult, 'unrelated-skill'))).toEqual([])
    expect(restoredTools(nativeHistory(rawResult, VISION_SKILLS_NAME, 'other-tool'))).toEqual([])
    expect(restoredTools(nativeHistory(rawResult).reverse())).toEqual([])
  })
})
