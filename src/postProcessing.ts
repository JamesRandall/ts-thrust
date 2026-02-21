export type PostProcessEffect = 'none' | 'crt' | 'greenCrt' | 'amberCrt' | 'vcr';

const EFFECTS: PostProcessEffect[] = ['none', 'crt', 'greenCrt', 'amberCrt', 'vcr'];

// --- WGSL Shaders ---

const vertexShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
};

@vertex
fn main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  // Fullscreen quad from 6 vertices (2 triangles)
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  var uv = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0),
  );
  var out: VertexOutput;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.texCoord = uv[vi];
  return out;
}
`;

const uniformsStruct = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  time: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;
@group(0) @binding(2) var srcSampler: sampler;
@group(0) @binding(3) var noiseTexture: texture_2d<f32>;
`;

const crtFragment = /* wgsl */ `
${uniformsStruct}

fn curve(uv_in: vec2f) -> vec2f {
  var uv = (uv_in - 0.5) * 2.0;
  uv = uv * 1.1;
  uv.x = uv.x * (1.0 + pow(abs(uv.y) / 5.0, 2.0));
  uv.y = uv.y * (1.0 + pow(abs(uv.x) / 4.0, 2.0));
  uv = uv / 2.0 + 0.5;
  uv = uv * 0.92 + 0.04;
  return uv;
}

@fragment
fn main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let res = uniforms.resolution;
  let time = uniforms.time;
  let q = texCoord;
  var uv = curve(q);

  let oob = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
  let suv = clamp(uv, vec2f(0.0), vec2f(1.0));

  // Animated horizontal distortion
  let x = sin(0.3 * time + suv.y * 21.0) * sin(0.7 * time + suv.y * 29.0) * sin(0.3 + 0.33 * time + suv.y * 31.0) * 0.0017;

  // Chromatic aberration with offset sampling
  var col: vec3f;
  col.x = textureSample(srcTexture, srcSampler, vec2f(x + suv.x + 0.001, suv.y + 0.001)).x + 0.05;
  col.y = textureSample(srcTexture, srcSampler, vec2f(x + suv.x + 0.000, suv.y - 0.002)).y + 0.05;
  col.z = textureSample(srcTexture, srcSampler, vec2f(x + suv.x - 0.002, suv.y + 0.000)).z + 0.05;

  // Bloom / glow
  col.x = col.x + 0.08 * textureSample(srcTexture, srcSampler, 0.75 * vec2f(x + 0.025, -0.027) + vec2f(suv.x + 0.001, suv.y + 0.001)).x;
  col.y = col.y + 0.05 * textureSample(srcTexture, srcSampler, 0.75 * vec2f(x - 0.022, -0.02) + vec2f(suv.x + 0.000, suv.y - 0.002)).y;
  col.z = col.z + 0.08 * textureSample(srcTexture, srcSampler, 0.75 * vec2f(x - 0.02, -0.018) + vec2f(suv.x - 0.002, suv.y + 0.000)).z;

  // Contrast curve
  col = clamp(col * 0.6 + 0.4 * col * col, vec3f(0.0), vec3f(1.0));

  // Vignette
  let vig = 16.0 * suv.x * suv.y * (1.0 - suv.x) * (1.0 - suv.y);
  col = col * vec3f(pow(vig, 0.3));

  // Color tint
  col = col * vec3f(0.95, 1.05, 0.95);
  col = col * 2.8;

  // Animated scanlines with subtle vertical jitter
  let jitter = sin(time * 60.0) * 0.0005;
  let scans = clamp(0.35 + 0.35 * sin(3.5 * time + (suv.y + jitter) * res.y * 1.5), 0.0, 1.0);
  let s = pow(scans, 1.7);
  col = col * vec3f(0.4 + 0.7 * s);

  // Flicker
  col = col * (1.0 + 0.01 * sin(110.0 * time));

  // OOB mask
  let mask = select(1.0, 0.0, oob);
  col = col * mask;

  // Pixel grid (every other column darkened)
  let pixelGrid = clamp((fract(texCoord.x * res.x * 0.5) * 2.0 - 1.0) * 2.0, 0.0, 1.0);
  col = col * (1.0 - 0.65 * vec3f(pixelGrid));

  return vec4f(col, 1.0);
}
`;

const greenCrtFragment = /* wgsl */ `
${uniformsStruct}

const N = 240.0;
const PI = 3.14159265358979323;

fn curve(uv_in: vec2f) -> vec2f {
  var uv = (uv_in - 0.5) * 2.0;
  uv = uv * 1.1;
  uv.x = uv.x * (1.0 + pow(abs(uv.y) / 5.0, 2.0));
  uv.y = uv.y * (1.0 + pow(abs(uv.x) / 4.0, 2.0));
  uv = uv / 2.0 + 0.5;
  uv = uv * 0.92 + 0.04;
  return uv;
}

@fragment
fn main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let time = uniforms.time;
  var uv = curve(texCoord);

  let oob = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
  let suv = clamp(uv, vec2f(0.0), vec2f(1.0));

  let jitter = sin(time * 60.0) * 0.0005;
  let scanLineBrightness = sin(fract((suv.y + jitter) * N) * PI);

  // Oversample: 4 taps across the scanline height to average out source alternating-line rendering
  let scanH = 1.0 / N;
  let base = floor(suv.y * N) / N;
  let c0 = textureSample(srcTexture, srcSampler, vec2f(suv.x, base + scanH * 0.125)).rgb;
  let c1 = textureSample(srcTexture, srcSampler, vec2f(suv.x, base + scanH * 0.375)).rgb;
  let c2 = textureSample(srcTexture, srcSampler, vec2f(suv.x, base + scanH * 0.625)).rgb;
  let c3 = textureSample(srcTexture, srcSampler, vec2f(suv.x, base + scanH * 0.875)).rgb;
  let col = (c0 + c1 + c2 + c3) * 0.25;

  let vig = 16.0 * suv.x * suv.y * (1.0 - suv.x) * (1.0 - suv.y);
  var result = col * vec3f(pow(vig, 0.2));

  result = result * (1.0 + 0.01 * sin(110.0 * time));

  let mask = select(1.0, 0.0, oob);
  result = result * mask;

  let inputBrightness = length(result);
  let final_color = vec3f(0.2, inputBrightness * 0.74, 0.0) * scanLineBrightness;

  return select(vec4f(final_color, 1.0), vec4f(0.0, 0.0, 0.0, 1.0), oob);
}
`;

const amberCrtFragment = /* wgsl */ `
${uniformsStruct}

const N = 240.0;
const PI = 3.14159265358979323;

fn curve(uv_in: vec2f) -> vec2f {
  var uv = (uv_in - 0.5) * 2.0;
  uv = uv * 1.1;
  uv.x = uv.x * (1.0 + pow(abs(uv.y) / 5.0, 2.0));
  uv.y = uv.y * (1.0 + pow(abs(uv.x) / 4.0, 2.0));
  uv = uv / 2.0 + 0.5;
  uv = uv * 0.92 + 0.04;
  return uv;
}

@fragment
fn main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let time = uniforms.time;
  var uv = curve(texCoord);

  let oob = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
  let suv = clamp(uv, vec2f(0.0), vec2f(1.0));

  let jitter = sin(time * 60.0) * 0.0005;
  let scanLineBrightness = sin(fract((suv.y + jitter) * N) * PI);

  // Oversample: 4 taps across the scanline height to average out source alternating-line rendering
  let scanH = 1.0 / N;
  let base = floor(suv.y * N) / N;
  let c0 = textureSample(srcTexture, srcSampler, vec2f(suv.x, base + scanH * 0.125)).rgb;
  let c1 = textureSample(srcTexture, srcSampler, vec2f(suv.x, base + scanH * 0.375)).rgb;
  let c2 = textureSample(srcTexture, srcSampler, vec2f(suv.x, base + scanH * 0.625)).rgb;
  let c3 = textureSample(srcTexture, srcSampler, vec2f(suv.x, base + scanH * 0.875)).rgb;
  let col = (c0 + c1 + c2 + c3) * 0.25;

  let vig = 16.0 * suv.x * suv.y * (1.0 - suv.x) * (1.0 - suv.y);
  var result = col * vec3f(pow(vig, 0.2));

  result = result * (1.0 + 0.01 * sin(110.0 * time));

  let mask = select(1.0, 0.0, oob);
  result = result * mask;

  let inputBrightness = length(result);
  let final_color = vec3f(inputBrightness, inputBrightness * 0.74, 0.0) * scanLineBrightness;

  return select(vec4f(final_color, 1.0), vec4f(0.0, 0.0, 0.0, 1.0), oob);
}
`;

const vcrFragment = /* wgsl */ `
${uniformsStruct}

fn noise(p: vec2f, time: f32) -> f32 {
  let s = textureSample(noiseTexture, srcSampler, vec2f(1.0, 2.0 * cos(time)) * time * 8.0 + p).x;
  return s * s;
}

fn onOff(a: f32, b: f32, c: f32, time: f32) -> f32 {
  return step(c, sin(time + a * cos(time * b)));
}

fn ramp(y: f32, start: f32, end: f32) -> f32 {
  let inside = step(start, y) - step(end, y);
  let fact = (y - start) / (end - start) * inside;
  return (1.0 - fact) * inside;
}

fn stripes(uv: vec2f, time: f32) -> f32 {
  let noi = noise(uv * vec2f(0.5, 1.0) + vec2f(1.0, 3.0), time);
  return ramp(fract(uv.y * 4.0 + time / 2.0 + sin(time + sin(time * 0.63))), 0.5, 0.6) * noi;
}

fn screenDistort(uv: vec2f) -> vec2f {
  var c = uv - vec2f(0.5, 0.5);
  c = c * 1.2 * (1.0 / 1.2 + 2.0 * c.x * c.x * c.y * c.y);
  return c + vec2f(0.5, 0.5);
}

fn getVideo(uv: vec2f, time: f32) -> vec3f {
  var look = uv;
  let window = 1.0 / (1.0 + 20.0 * (look.y - fract(time / 4.0)) * (look.y - fract(time / 4.0)));
  look.x = look.x + sin(look.y * 10.0 + time) / 50.0 * onOff(4.0, 4.0, 0.3, time) * (1.0 + cos(time * 80.0)) * window;
  let vShift = 0.4 * onOff(2.0, 3.0, 0.9, time) * (sin(time) * sin(time * 20.0) +
    (0.5 + 0.1 * sin(time * 200.0) * cos(time)));
  look.y = fract(look.y + vShift);
  let video = textureSample(srcTexture, srcSampler, clamp(look, vec2f(0.0), vec2f(1.0))).rgb;
  return video;
}

@fragment
fn main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let time = uniforms.time;
  var uv = screenDistort(texCoord);

  let oob = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
  uv = clamp(uv, vec2f(0.0), vec2f(1.0));

  var video = getVideo(uv, time);

  let vigAmt = 3.0 + 0.3 * sin(time + 5.0 * cos(time * 5.0));
  let vignette = (1.0 - vigAmt * (uv.y - 0.5) * (uv.y - 0.5)) * (1.0 - vigAmt * (uv.x - 0.5) * (uv.x - 0.5));

  video = video + vec3f(stripes(uv, time));
  video = video + vec3f(noise(uv * 2.0, time) / 2.0);
  video = video * vignette;
  video = video * (12.0 + fract(uv.y * 30.0 + time)) / 13.0;

  return select(vec4f(video, 1.0), vec4f(0.0, 0.0, 0.0, 1.0), oob);
}
`;

const fragmentShaders: Record<Exclude<PostProcessEffect, 'none'>, string> = {
  crt: crtFragment,
  greenCrt: greenCrtFragment,
  amberCrt: amberCrtFragment,
  vcr: vcrFragment,
};

export class PostProcessor {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipelines: Map<string, GPURenderPipeline> = new Map();
  private sampler: GPUSampler | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private sourceTexture: GPUTexture | null = null;
  private noiseTexture: GPUTexture | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;

  private gameCanvas: HTMLCanvasElement;
  private ppCanvas: HTMLCanvasElement;
  private currentEffect: PostProcessEffect = 'none';
  private internalW: number;
  private internalH: number;
  private outputScale: number;

  constructor(gameCanvas: HTMLCanvasElement, ppCanvas: HTMLCanvasElement, internalW: number, internalH: number) {
    this.gameCanvas = gameCanvas;
    this.ppCanvas = ppCanvas;
    this.internalW = internalW;
    this.internalH = internalH;
    this.outputScale = 4;
  }

  async init(): Promise<boolean> {
    if (!navigator.gpu) return false;

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;

    const device = await adapter.requestDevice();
    this.device = device;

    // Configure the postprocess canvas at higher resolution for scanline fidelity
    this.ppCanvas.width = this.internalW * this.outputScale;
    this.ppCanvas.height = this.internalH * this.outputScale;

    const context = this.ppCanvas.getContext('webgpu');
    if (!context) return false;
    this.context = context;

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
    });

    // Create sampler
    this.sampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
    });

    // Create uniform buffer (resolution vec2f + time f32 + padding = 16 bytes)
    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create source texture
    this.sourceTexture = device.createTexture({
      size: [this.internalW, this.internalH],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Create noise texture (256x256)
    const noiseSize = 256;
    const noiseData = new Uint8Array(noiseSize * noiseSize * 4);
    for (let i = 0; i < noiseSize * noiseSize; i++) {
      const v = Math.floor(Math.random() * 256);
      noiseData[i * 4] = v;
      noiseData[i * 4 + 1] = v;
      noiseData[i * 4 + 2] = v;
      noiseData[i * 4 + 3] = 255;
    }
    this.noiseTexture = device.createTexture({
      size: [noiseSize, noiseSize],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.noiseTexture },
      noiseData,
      { bytesPerRow: noiseSize * 4 },
      [noiseSize, noiseSize],
    );

    // Create bind group layout
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });

    // Create bind group
    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sourceTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.noiseTexture.createView() },
      ],
    });

    // Create vertex shader module
    const vertModule = device.createShaderModule({ code: vertexShader });

    // Create pipeline layout
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    // Create a pipeline for each effect
    for (const [name, fragCode] of Object.entries(fragmentShaders)) {
      const fragModule = device.createShaderModule({ code: fragCode });
      const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: vertModule,
          entryPoint: 'main',
        },
        fragment: {
          module: fragModule,
          entryPoint: 'main',
          targets: [{ format }],
        },
        primitive: {
          topology: 'triangle-list',
        },
      });
      this.pipelines.set(name, pipeline);
    }

    return true;
  }

  get effect(): PostProcessEffect {
    return this.currentEffect;
  }

  setEffect(effect: PostProcessEffect) {
    this.currentEffect = effect;
    if (effect === 'none') {
      this.gameCanvas.style.visibility = 'visible';
      this.ppCanvas.style.display = 'none';
    } else {
      // Keep game canvas in layout flow (visibility:hidden) so the container keeps its size
      this.gameCanvas.style.visibility = 'hidden';
      this.ppCanvas.style.display = 'block';
    }
  }

  cycleEffect(direction: 1 | -1) {
    const idx = EFFECTS.indexOf(this.currentEffect);
    const next = (idx + direction + EFFECTS.length) % EFFECTS.length;
    this.setEffect(EFFECTS[next]);
  }

  render(time: number) {
    if (this.currentEffect === 'none' || !this.device || !this.context) return;

    const device = this.device;
    const pipeline = this.pipelines.get(this.currentEffect);
    if (!pipeline) return;

    // Copy game canvas to GPU texture
    device.queue.copyExternalImageToTexture(
      { source: this.gameCanvas },
      { texture: this.sourceTexture! },
      [this.internalW, this.internalH],
    );

    // Update uniforms — resolution is the output canvas size for scanline calculations
    const outW = this.internalW * this.outputScale;
    const outH = this.internalH * this.outputScale;
    const uniformData = new Float32Array([outW, outH, time / 1000, 0]);
    device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);

    // Render
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(6);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }
}
