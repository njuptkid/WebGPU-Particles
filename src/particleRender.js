// Particle rendering using instanced rendering
// Each particle is rendered as a small quad with configurable size

class ParticleRenderProgram {
  constructor() {
    // Create vertex buffer for quad vertices (6 vertices = 2 triangles)
    const vertices = new Float32Array([
      -1.0, -1.0,  // triangle 1
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,  // triangle 2
       1.0, -1.0,
       1.0,  1.0,
    ]);

    this.vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(vertices);
    this.vertexBuffer.unmap();

    const vertexBuffersDescriptors = [
      {
        attributes: [
          {
            shaderLocation: 0,
            offset: 0,
            format: "float32x2",
          },
        ],
        arrayStride: 8,
        stepMode: "vertex",
      },
    ];

    const shaderModule = device.createShaderModule({
      code: particleRenderShader
    });

    // Create render pipeline with alpha blending
    this.renderPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vertex_main",
        buffers: vertexBuffersDescriptors,
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragment_main",
        targets: [
          {
            format: presentationFormat,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add"
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add"
              }
            }
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    // Bind group will be created dynamically in dispatch
    // to use the current particle buffers
    this.renderPassDescriptor = {
      colorAttachments: [
        {
          loadOp: "load",  // Preserve background (dye)
          storeOp: "store",
        },
      ],
    };
  }

  // Dispatch a draw command to render particles on the canvas
  dispatch(commandEncoder) {
    // Update the color attachment to use the current texture
    this.renderPassDescriptor.colorAttachments[0].view = context
      .getCurrentTexture()
      .createView();

    const renderPassEncoder = commandEncoder.beginRenderPass(
      this.renderPassDescriptor
    );

    renderPassEncoder.setPipeline(this.renderPipeline);
    renderPassEncoder.setBindGroup(0, this.getBindGroup());
    renderPassEncoder.setVertexBuffer(0, this.vertexBuffer);
    // Draw 6 vertices per particle (2 triangles), 10000 particles
    renderPassEncoder.draw(6, 10000);
    renderPassEncoder.end();
  }

  // Create bind group with current particle buffers
  getBindGroup() {
    const entries = [
      particles.buffers[0],  // posX
      particles.buffers[1],  // posY
      particleLife.buffers[0],  // life
      globalUniforms.particle_max_life.buffer,
      globalUniforms.particle_render_size.buffer,
    ].map((b, i) => ({
      binding: i,
      resource: { buffer: b },
    }));

    return device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries
    });
  }
}
