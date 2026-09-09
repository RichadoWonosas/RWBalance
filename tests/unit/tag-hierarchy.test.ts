import { expect, it } from 'vitest'
import { assertCanSetParent, expandTagAncestors, flattenTagHierarchy, validateTagHierarchy } from '../../src/core/domain/tag-hierarchy'

const tags = [{ id: 'entertainment' }, { id: 'games', parentId: 'entertainment' }, { id: 'dlc', parentId: 'games' }, { id: 'films', parentId: 'entertainment' }]
it('rejects self, descendant, disconnected cycles, duplicate IDs and missing parents', () => {
  expect(() => assertCanSetParent(tags, 'games', 'games')).toThrow('成环')
  expect(() => assertCanSetParent(tags, 'entertainment', 'dlc')).toThrow('成环')
  expect(() => assertCanSetParent(tags, 'games', 'foreign')).toThrow('不存在')
  expect(() => validateTagHierarchy([...tags, { id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }])).toThrow('成环')
  expect(() => validateTagHierarchy([...tags, { id: 'games' }])).toThrow('重复')
  expect(() => validateTagHierarchy([{ id: 'x', parentId: 'missing' }])).toThrow('不存在')
  expect(() => assertCanSetParent(tags, 'games')).not.toThrow()
})
it('preserves direct order and retains ancestors needed by remaining selections', () => {
  expect(expandTagAncestors(tags, ['dlc', 'films'])).toEqual(['dlc', 'films', 'games', 'entertainment'])
  expect(expandTagAncestors(tags, ['films'])).toEqual(['films', 'entertainment'])
  expect(expandTagAncestors(tags, ['entertainment'])).toEqual(['entertainment'])
  expect(expandTagAncestors(tags, [])).toEqual([])
  expect(() => expandTagAncestors(tags, ['missing'])).toThrow('不存在')
})
it('validates deeply nested imported trees without recursion', () => {
  const deep = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), parentId: i ? String(i - 1) : undefined }))
  expect(() => validateTagHierarchy(deep)).not.toThrow()
  expect(expandTagAncestors(deep, ['9999'])).toHaveLength(10000)
})
it('groups descendants directly after each parent using hierarchy then creation order', () => {
  const dated = [
    { id: 'a', createdAt: '2026-01-01' },
    { id: 'b', createdAt: '2026-01-02' },
    { id: 'a-1', parentId: 'a', createdAt: '2026-01-03' },
    { id: 'a-1-1', parentId: 'a-1', createdAt: '2026-01-05' },
    { id: 'a-2', parentId: 'a', createdAt: '2026-01-04' },
  ]
  expect(flattenTagHierarchy(dated).map(row => [row.tag.id, row.depth, row.hasChildren])).toEqual([
    ['a', 0, true], ['a-1', 1, true], ['a-1-1', 2, false], ['a-2', 1, false], ['b', 0, false],
  ])
})
