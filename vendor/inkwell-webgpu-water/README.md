# Inkwell WebGPU Water attribution

This game adapts the deterministic spectral-cascade data, Stockham inverse
FFT field packing, fold derivatives, and water optical hierarchy from
[siliconjungle/inkwell-webgpu-water](https://github.com/siliconjungle/inkwell-webgpu-water),
commit `9b9a5ebfaf1600fee0a2e6c56da0720a54bfbcd2`.

The original standalone raw-WebGPU renderer was reworked as a Three.js TSL
simulation so it can share this game's terrain-shaped river/sea mesh, sky and
celestial state, scene-color/depth capture, day/night system, and WebGL2-node
compatibility fallback.

See [LICENSE](LICENSE) for the upstream MIT license.
