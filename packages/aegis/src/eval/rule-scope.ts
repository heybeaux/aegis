/** ProcessInput refines the host process tool and retains its configured policy scope. */
export function ruleApplies(appliesTo: string[], tool: string): boolean {
  return appliesTo.includes('*') || appliesTo.includes(tool) ||
    (tool === 'ProcessInput' && appliesTo.includes('process'));
}
