struct Uniforms {
  resolution: vec2f,
  time: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;
@group(0) @binding(2) var srcSampler: sampler;
@group(0) @binding(3) var noiseTexture: texture_2d<f32>;

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

  // Static noise
  let frame = floor(time * 30.0);
  let noiseUV = fract(suv * 1.5 + vec2f(sin(frame * 127.1) * 43758.5, cos(frame * 311.7) * 43758.5));
  let staticNoise = textureSample(noiseTexture, srcSampler, noiseUV).r;
  col = col + vec3f((staticNoise - 0.5) * 0.12);

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
