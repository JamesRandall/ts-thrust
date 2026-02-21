struct Uniforms {
  resolution: vec2f,
  time: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;
@group(0) @binding(2) var srcSampler: sampler;
@group(0) @binding(3) var noiseTexture: texture_2d<f32>;

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
