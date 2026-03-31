// 3D Particle rendering with perspective projection
class ParticleRenderProgram {
    constructor() {
        const vertices = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
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

        // Compute fixed perspective MVP matrix
        this.mvpMatrix = this.computeMVP();

        // Uniform buffer: mat4x4 (16 floats) + particleSize + maxLife + screenWidth + screenHeight
        const uniformData = new Float32Array(20);
        uniformData.set(this.mvpMatrix, 0);
        uniformData[16] = settings.particle_render_size;
        uniformData[17] = settings.particle_max_life;
        uniformData[18] = canvas.width;
        uniformData[19] = canvas.height;

        this.uniformBuffer = device.createBuffer({
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.uniformBuffer.getMappedRange()).set(uniformData);
        this.uniformBuffer.unmap();

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
                                dstFactor: "one",
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
            depthStencil: {
                depthWriteEnabled: false,
                depthCompare: "always",
                format: "depth32float",
            },
        });

        // Create depth texture
        this.depthTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: "depth32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.renderPassDescriptor = {
            colorAttachments: [
                {
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                },
            ],
            depthStencilAttachment: {
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                view: this.depthTexture.createView(),
            },
        };

        // Cache bind group (recreate only on resize)
        this._cachedBindGroup = this._createBindGroup();
    }

    computeMVP() {
        // Fixed perspective camera looking at center of the volume
        const fov = 45 * Math.PI / 180;
        const aspect = canvas.width / canvas.height;
        const near = 0.1;
        const far = 10.0;

        // Perspective matrix
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);
        const proj = [
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0,
        ];

        // View matrix: lookAt(eye, target, up)
        const eye = [0.0, 0.0, 2.2];
        const target = [0, 0, 0];
        const up = [0, 1, 0];

        const zAxis = normalize(subtract(eye, target));
        const xAxis = normalize(cross(up, zAxis));
        const yAxis = cross(zAxis, xAxis);

        const view = [
            xAxis[0], yAxis[0], zAxis[0], 0,
            xAxis[1], yAxis[1], zAxis[1], 0,
            xAxis[2], yAxis[2], zAxis[2], 0,
            -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1,
        ];

        // MVP = proj * view (column-major)
        return multiplyMat4(proj, view);
    }

    dispatch(commandEncoder) {
        // Update uniforms each frame
        const uniformData = new Float32Array(20);
        uniformData.set(this.mvpMatrix, 0);
        uniformData[16] = settings.particle_render_size;
        uniformData[17] = settings.particle_max_life;
        uniformData[18] = canvas.width;
        uniformData[19] = canvas.height;
        device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        this.renderPassDescriptor.colorAttachments[0].view = context
            .getCurrentTexture()
            .createView();

        const renderPassEncoder = commandEncoder.beginRenderPass(
            this.renderPassDescriptor
        );

        renderPassEncoder.setPipeline(this.renderPipeline);
        renderPassEncoder.setBindGroup(0, this._cachedBindGroup);
        renderPassEncoder.setVertexBuffer(0, this.vertexBuffer);
        renderPassEncoder.draw(6, 10000);
        renderPassEncoder.end();
    }

    _createBindGroup() {
        const entries = [
            particles.buffers[0],    // positions (stride-3: x,y,z interleaved)
            particleLife.buffers[0], // life
            this.uniformBuffer,      // uniforms (mvp + params)
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

// Vector math helpers
function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalize(v) { const l = Math.sqrt(dot(v, v)); return [v[0] / l, v[1] / l, v[2] / l]; }

// Column-major 4x4 matrix multiply
function multiplyMat4(a, b) {
    const out = new Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col * 4 + row] =
                a[0 * 4 + row] * b[col * 4 + 0] +
                a[1 * 4 + row] * b[col * 4 + 1] +
                a[2 * 4 + row] * b[col * 4 + 2] +
                a[3 * 4 + row] * b[col * 4 + 3];
        }
    }
    return out;
}
