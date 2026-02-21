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
