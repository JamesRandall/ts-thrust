struct Uniforms {
  resolution: vec2f,
  time: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;
@group(0) @binding(2) var srcSampler: sampler;
@group(0) @binding(3) var noiseTexture: texture_2d<f32>;

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
