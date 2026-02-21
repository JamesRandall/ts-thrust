import vertexShader from './shaders/fullscreen.vert.wgsl?raw';
import crtFragment from './shaders/crt.frag.wgsl?raw';
import greenCrtFragment from './shaders/greenCrt.frag.wgsl?raw';
import amberCrtFragment from './shaders/amberCrt.frag.wgsl?raw';
import bwTvFragment from './shaders/bwTv.frag.wgsl?raw';
import vcrFragment from './shaders/vcr.frag.wgsl?raw';

export type PostProcessEffect = 'none' | 'crt' | 'greenCrt' | 'amberCrt' | 'bwTv' | 'vcr';

const EFFECTS: PostProcessEffect[] = ['none', 'crt', 'bwTv', 'greenCrt', 'amberCrt', 'vcr'];

const fragmentShaders: Record<Exclude<PostProcessEffect, 'none'>, string> = {
  crt: crtFragment,
  greenCrt: greenCrtFragment,
  amberCrt: amberCrtFragment,
  bwTv: bwTvFragment,
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
