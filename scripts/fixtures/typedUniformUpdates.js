// Experimental CPU probe. Uses Three's existing packers and never skips value
// updates. Keep outside gameplay until the native-render comparison shows a gain.
export function prepareTypedUniformUpdates(binding) {
  if (!binding.isUniformsGroup) return null;
  const flags = ['isNumberUniform', 'isVector2Uniform', 'isVector3Uniform',
    'isVector4Uniform', 'isColorUniform', 'isMatrix3Uniform', 'isMatrix4Uniform'];
  const buckets = flags.map(() => []);
  for (const uniform of binding.uniforms) {
    const type = flags.findIndex(flag => uniform[flag]);
    if (type < 0) return null;
    buckets[type].push(uniform);
  }
  const original = binding.update, layout = binding.uniforms, count = layout.length;
  const [numbers, vectors2, vectors3, vectors4, colors, matrices3, matrices4] = buckets;
  const update = function() {
    if (this.uniforms !== layout || this.uniforms.length !== count) return original.call(this);
    let changed = false;
    for (const u of numbers) if (this.updateNumber(u)) changed = true;
    for (const u of vectors2) if (this.updateVector2(u)) changed = true;
    for (const u of vectors3) if (this.updateVector3(u)) changed = true;
    for (const u of vectors4) if (this.updateVector4(u)) changed = true;
    for (const u of colors) if (this.updateColor(u)) changed = true;
    for (const u of matrices3) if (this.updateMatrix3(u)) changed = true;
    for (const u of matrices4) if (this.updateMatrix4(u)) changed = true;
    return changed;
  };
  return { count, enable() { binding.update = update; }, disable() { binding.update = original; } };
}
