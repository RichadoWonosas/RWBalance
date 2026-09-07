import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import { parse as parseTemplate, NodeTypes, type RootNode, type TemplateChildNode } from '@vue/compiler-dom'
import { expect, it } from 'vitest'

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? vueFiles(join(dir, entry.name)) : entry.name.endsWith('.vue') ? [join(dir, entry.name)] : [])
}

it('all form controls have an explicit id or name, including conditional dialogs', () => {
  const missing: string[] = []
  for (const file of vueFiles('src')) {
    const template = parse(readFileSync(file, 'utf8')).descriptor.template
    if (!template) continue
    function visit(node: RootNode | TemplateChildNode) {
      if (node.type === NodeTypes.ELEMENT) {
        if (['input', 'select', 'textarea'].includes(node.tag)) {
          const identified = node.props.some(prop => prop.type === NodeTypes.ATTRIBUTE
            ? ['id', 'name'].includes(prop.name) && Boolean(prop.value?.content.trim())
            : prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && ['id', 'name'].includes(prop.arg.content))
          if (!identified) missing.push(`${file}:${node.loc.start.line} ${node.tag}`)
        }
      }
      if (node.type === NodeTypes.ROOT || node.type === NodeTypes.ELEMENT) node.children.forEach(visit)
    }
    visit(parseTemplate(template.content))
  }
  expect(missing).toEqual([])
})
