/** Shared hierarchy rules for domain mutations, import validation and selectors. */
export interface HierarchyTag { id: string; parentId?: string }

function indexTags(tags: readonly HierarchyTag[]): Map<string, HierarchyTag> {
  const index = new Map<string, HierarchyTag>()
  for (const tag of tags) {
    if (!tag.id || index.has(tag.id)) throw new Error('标签 ID 为空或重复')
    if (tag.parentId !== undefined && (typeof tag.parentId !== 'string' || !tag.parentId)) throw new Error('父标签 ID 无效')
    index.set(tag.id, tag)
  }
  return index
}

export function tagPath(tags: readonly (HierarchyTag & { name: string })[], id: string): string {
  const index = new Map(tags.map(tag => [tag.id, tag])), path: string[] = [], seen = new Set<string>()
  let current: string | undefined = id
  while (current && !seen.has(current)) {
    seen.add(current)
    const tag = index.get(current)
    if (!tag) break
    path.push(tag.name)
    current = tag.parentId
  }
  return path.reverse().join(' › ')
}

export function rootTagId(tags: readonly HierarchyTag[], id: string): string {
  return expandTagAncestors(tags, [id]).at(-1) ?? id
}

export interface HierarchyRow<T> { tag: T; depth: number; hasChildren: boolean }

/** Pre-order tree traversal. Siblings retain creation order, then source order. */
export function flattenTagHierarchy<T extends HierarchyTag & { createdAt: string }>(tags: readonly T[]): HierarchyRow<T>[] {
  validateTagHierarchy(tags)
  const sourceOrder = new Map(tags.map((tag, index) => [tag.id, index]))
  const children = new Map<string | undefined, T[]>()
  for (const tag of tags) children.set(tag.parentId, [...(children.get(tag.parentId) ?? []), tag])
  const sort = (items: T[]) => items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || sourceOrder.get(a.id)! - sourceOrder.get(b.id)!)
  for (const items of children.values()) sort(items)
  const rows: HierarchyRow<T>[] = [], stack = [...(children.get(undefined) ?? [])].reverse().map(tag => ({ tag, depth: 0 }))
  while (stack.length) {
    const item = stack.pop()!
    const descendants = children.get(item.tag.id) ?? []
    rows.push({ ...item, hasChildren: descendants.length > 0 })
    for (let index = descendants.length - 1; index >= 0; index--) stack.push({ tag: descendants[index]!, depth: item.depth + 1 })
  }
  return rows
}

export function assertCanSetParent(tags: readonly HierarchyTag[], childId: string, parentId?: string): void {
  const index = indexTags(tags)
  if (!index.has(childId)) throw new Error('标签不存在')
  const visited = new Set([childId])
  let current = parentId
  while (current !== undefined) {
    if (visited.has(current)) throw new Error('父子标签关系不能成环')
    const tag = index.get(current)
    if (!tag) throw new Error('父标签不存在')
    visited.add(current)
    current = tag.parentId
  }
}

/** Linear-time validation with iterative traversal, including disconnected components. */
export function validateTagHierarchy(tags: readonly HierarchyTag[]): void {
  const index = indexTags(tags), complete = new Set<string>()
  for (const tag of tags) {
    const path = new Set<string>()
    let current: string | undefined = tag.id
    while (current !== undefined && !complete.has(current)) {
      if (path.has(current)) throw new Error('父子标签关系不能成环')
      const item = index.get(current)
      if (!item) throw new Error('父标签不存在')
      path.add(current)
      current = item.parentId
    }
    path.forEach(id => complete.add(id))
  }
}

/** Keeps direct selection order, then appends each needed ancestor at most once. */
export function expandTagAncestors(tags: readonly HierarchyTag[], explicitIds: readonly string[]): string[] {
  validateTagHierarchy(tags)
  const index = indexTags(tags), result = new Set(explicitIds)
  const expanded = new Set<string>()
  for (const id of explicitIds) {
    let current: string | undefined = id
    while (current !== undefined && !expanded.has(current)) {
      const tag = index.get(current)
      if (!tag) throw new Error('标签不存在')
      expanded.add(current)
      result.add(current)
      current = tag.parentId
    }
  }
  return [...result]
}
