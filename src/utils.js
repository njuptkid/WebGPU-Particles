// Single-buffer DynamicBuffer with optional interleaved components
// components=1 → scalar (pressure, divergence, life)
// components=3 → vector stored as stride-3 array<f32> (velocity, vorticity, positions)
class DynamicBuffer {
    constructor({
        components = 1,
        w = settings.grid_w,
        h = settings.grid_h,
        d = settings.grid_d
    } = {}) {
        this.components = components
        this.w = w
        this.h = h
        this.d = d
        this.cellCount = w * h * d
        this.bufferSize = this.cellCount * components * 4
        this.buffers = [device.createBuffer({
            size: this.bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        })]
    }

    copyTo(buffer, commandEncoder) {
        commandEncoder.copyBufferToBuffer(
            this.buffers[0], 0,
            buffer.buffers[0], 0,
            Math.min(this.bufferSize, buffer.bufferSize)
        )
    }

    clear(queue) {
        queue.writeBuffer(this.buffers[0], 0, new Float32Array(this.cellCount * this.components))
    }
}

// Uniform buffer manager linked to GUI controls
class Uniform {
    constructor(name, { size, value, min, max, step, onChange, displayName, addToGUI = true } = {}) {
        this.name = name
        this.size = size ?? (typeof (value) === "object" ? value.length : 1)
        this.needsUpdate = false

        if (this.size === 1) {
            if (settings[name] == null) {
                settings[name] = value ?? 0
                this.alwaysUpdate = true
            }
            else if (addToGUI) {
                gui.add(settings, name, min, max, step)
                    .onChange((v) => {
                        if (onChange) onChange(v)
                        this.needsUpdate = true
                    })
                    .name(displayName ?? name)
            }
        }

        if (this.size === 1 || value != null) {
            this.buffer = device.createBuffer({
                mappedAtCreation: true,
                size: this.size * 4,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
            const arrayBuffer = this.buffer.getMappedRange();
            new Float32Array(arrayBuffer).set(new Float32Array(value ?? [settings[name]]));
            this.buffer.unmap();
        } else {
            this.buffer = device.createBuffer({
                size: this.size * 4,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        }

        globalUniforms[name] = this
    }

    setValue(value) {
        settings[this.name] = value
        this.needsUpdate = true
    }

    update(queue, value) {
        if (this.needsUpdate || this.alwaysUpdate || value != null) {
            if (typeof (this.needsUpdate) !== "boolean") value = this.needsUpdate
            queue.writeBuffer(this.buffer, 0, new Float32Array(value ?? [parseFloat(settings[this.name])]), 0, this.size)
            this.needsUpdate = false
        }
    }
}

// Each DynamicBuffer contributes exactly 1 binding (no more flat())
class Program {
    constructor({
        buffers = [],
        uniforms = [],
        shader,
        dispatchX = settings.grid_w,
        dispatchY = settings.grid_h,
        dispatchZ = settings.grid_d,
    }) {
        this.computePipeline = device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: device.createShaderModule({ code: shader }),
                entryPoint: "main"
            }
        })

        let entries = buffers.map(b => ({ buffer: b.buffers[0] }))
        entries.push(...uniforms.map(({ buffer }) => ({ buffer })))
        entries = entries.map((e, i) => ({
            binding: i,
            resource: e
        }))

        this.bindGroup = device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: entries
        })

        this.dispatchX = dispatchX
        this.dispatchY = dispatchY
        this.dispatchZ = dispatchZ
    }

    dispatch(passEncoder) {
        passEncoder.setPipeline(this.computePipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.dispatchWorkgroups(
            Math.ceil(this.dispatchX / 8),
            Math.ceil(this.dispatchY / 8),
            Math.ceil(this.dispatchZ / 4)
        );
    }
}
