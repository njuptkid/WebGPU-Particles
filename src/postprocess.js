const fullscreenQuadWGSL = /* wgsl */`
struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

@vertex
fn vertex_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
    let pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0)
    );
    let uv = array<vec2<f32>, 3>(
        vec2<f32>( 0.0,  1.0),
        vec2<f32>( 2.0,  1.0),
        vec2<f32>( 0.0, -1.0)
    );
    var output : VertexOutput;
    output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
    output.uv = uv[VertexIndex];
    return output;
}
`

class RenderTarget {
    constructor(device, presentationFormat) {
        this.device = device;
        this.format = presentationFormat;
        this.width = canvas.width;
        this.height = canvas.height;
        this.createTexture();
    }

    createTexture() {
        if (this.texture) this.texture.destroy();
        this.texture = this.device.createTexture({
            size: [this.width, this.height, 1],
            format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.view = this.texture.createView();
    }

    resize(ctxWidth, ctxHeight) {
        if (this.width !== ctxWidth || this.height !== ctxHeight) {
            this.width = ctxWidth;
            this.height = ctxHeight;
            this.createTexture();
        }
    }
}

class PostProcessChain {
    constructor(device, presentationFormat) {
        this.device = device;
        this.format = presentationFormat;
        this.effects = [];
        this.mainRT = new RenderTarget(device, presentationFormat);
        this.pingRT = new RenderTarget(device, presentationFormat);
        this.pongRT = new RenderTarget(device, presentationFormat);

        this.sampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this._setupBlitPipeline();
    }

    _setupBlitPipeline() {
        const blitWGSL = /* wgsl */`
        @group(0) @binding(0) var srcSampler : sampler;
        @group(0) @binding(1) var srcTexture : texture_2d<f32>;

        @fragment
        fn fragment_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
            return textureSample(srcTexture, srcSampler, uv);
        }`;

        const shaderModule = this.device.createShaderModule({
            code: fullscreenQuadWGSL + "\n" + blitWGSL
        });

        this.blitPipeline = this.device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: shaderModule,
                entryPoint: "vertex_main"
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fragment_main",
                targets: [{ format: this.format }]
            },
            primitive: { topology: "triangle-list" }
        });
    }

    addEffect(effect) {
        effect.init(this.device, this.format, this.sampler);
        this.effects.push(effect);
    }

    resize(width, height) {
        this.mainRT.resize(width, height);
        this.pingRT.resize(width, height);
        this.pongRT.resize(width, height);
        this.effects.forEach(e => {
            if (e.resize) e.resize(width, height);
        });
    }

    render(commandEncoder, finalDestinationView) {
        let currentInput = this.mainRT;
        let currentOutput = this.pingRT;

        if (this.effects.length === 0) {
            this.blit(commandEncoder, this.mainRT.view, finalDestinationView);
            return;
        }

        for (let i = 0; i < this.effects.length; i++) {
            // 最后一次 effect 直接写入 finalDestinationView
            let viewOut = (i === this.effects.length - 1) ? finalDestinationView : currentOutput.view;
            this.effects[i].render(commandEncoder, currentInput.view, viewOut);

            // Swap buffer for next effect
            let temp = currentInput;
            currentInput = currentOutput;
            currentOutput = (currentOutput === this.pingRT) ? this.pongRT : this.pingRT;
        }
    }

    blit(commandEncoder, srcView, dstView) {
        const bindGroup = this.device.createBindGroup({
            layout: this.blitPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: srcView }
            ]
        });

        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: dstView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear",
                storeOp: "store"
            }]
        });
        passEncoder.setPipeline(this.blitPipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(3, 1, 0, 0);
        passEncoder.end();
    }
}

// ---------------------------------------------
// Bloom Effect Implementation
// ---------------------------------------------
class BloomEffect {
    constructor() {
        this.settings = {
            threshold: 0.85,
            intensity: 1.5,
            blurRadius: 1.0
        };
        // Ensure Uniform exists for dat.gui
        settings.bloomThreshold = this.settings.threshold;
        settings.bloomIntensity = this.settings.intensity;
        settings.bloomRadius = this.settings.blurRadius;
    }

    init(device, format, sampler) {
        this.device = device;
        this.format = format;
        this.sampler = sampler;

        // Internal targets for downsample and blur
        // Scale down to 1/2 size to increase blur footprint and performance
        this.width = Math.floor(canvas.width / 2);
        this.height = Math.floor(canvas.height / 2);

        this.rt1 = new RenderTarget(device, format);
        this.rt2 = new RenderTarget(device, format);
        this.rt1.resize(this.width, this.height);
        this.rt2.resize(this.width, this.height);

        this._setupUniforms();
        this._setupPipelines();
    }

    resize(width, height) {
        this.width = Math.floor(width / 2);
        this.height = Math.floor(height / 2);
        this.rt1.resize(this.width, this.height);
        this.rt2.resize(this.width, this.height);

        // Update resolution uniforms
        this.device.queue.writeBuffer(this.blurUniformsH, 0, new Float32Array([1.0, 0.0, this.width, this.height]));
        this.device.queue.writeBuffer(this.blurUniformsV, 0, new Float32Array([0.0, 1.0, this.width, this.height]));
    }

    _setupUniforms() {
        this.bloomUniforms = this.device.createBuffer({
            size: 2 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // vec2 direction, vec2 resolution
        this.blurUniformsH = this.device.createBuffer({
            size: 4 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.blurUniformsV = this.device.createBuffer({
            size: 4 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(this.bloomUniforms, 0, new Float32Array([this.settings.threshold, this.settings.intensity]));
        this.device.queue.writeBuffer(this.blurUniformsH, 0, new Float32Array([1.0, 0.0, this.width, this.height]));
        this.device.queue.writeBuffer(this.blurUniformsV, 0, new Float32Array([0.0, 1.0, this.width, this.height]));
    }

    _setupPipelines() {
        // 1. Threshold
        const thresholdWGSL = /* wgsl */`
        @group(0) @binding(0) var srcSampler : sampler;
        @group(0) @binding(1) var srcTexture : texture_2d<f32>;
        struct Uniforms { threshold: f32, intensity: f32 }
        @group(0) @binding(2) var<uniform> bloomUniforms : Uniforms;

        @fragment
        fn fragment_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
            let color = textureSample(srcTexture, srcSampler, uv);
            // Simple luminance
            let brightness = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
            if (brightness > bloomUniforms.threshold) {
                return color;
            }
            return vec4<f32>(0.0, 0.0, 0.0, 1.0);
        }`;

        this.thresholdPipeline = this._createPipeline(thresholdWGSL);

        // 2. Blur
        const blurWGSL = /* wgsl */`
        @group(0) @binding(0) var srcSampler : sampler;
        @group(0) @binding(1) var srcTexture : texture_2d<f32>;
        struct BlurUniforms { dir: vec2<f32>, res: vec2<f32> }
        @group(0) @binding(2) var<uniform> blurUniforms : BlurUniforms;

        @fragment
        fn fragment_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
            let offset = blurUniforms.dir / blurUniforms.res;
            var color = vec4<f32>(0.0);
            let weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
            
            color += textureSample(srcTexture, srcSampler, uv) * weights[0];
            for(var i = 1; i < 5; i++) {
                let step = offset * f32(i) * 1.5; // multiplier for wider blur
                color += textureSample(srcTexture, srcSampler, uv + step) * weights[i];
                color += textureSample(srcTexture, srcSampler, uv - step) * weights[i];
            }
            return color;
        }`;

        this.blurPipeline = this._createPipeline(blurWGSL);

        // 3. Composite
        const compositeWGSL = /* wgsl */`
        @group(0) @binding(0) var srcSampler : sampler;
        @group(0) @binding(1) var mainTex : texture_2d<f32>;
        @group(0) @binding(2) var bloomTex : texture_2d<f32>;
        struct Uniforms { threshold: f32, intensity: f32 }
        @group(0) @binding(3) var<uniform> bloomUniforms : Uniforms;

        @fragment
        fn fragment_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
            let baseParams = textureSample(mainTex, srcSampler, uv);
            let bloomParams = textureSample(bloomTex, srcSampler, uv);
            return baseParams + bloomParams * bloomUniforms.intensity;
        }`;

        const shaderModuleCmp = this.device.createShaderModule({ code: fullscreenQuadWGSL + "\n" + compositeWGSL });
        this.compositePipeline = this.device.createRenderPipeline({
            layout: "auto",
            vertex: { module: shaderModuleCmp, entryPoint: "vertex_main" },
            fragment: { module: shaderModuleCmp, entryPoint: "fragment_main", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list" }
        });
    }

    _createPipeline(fragmentCode) {
        const shaderModule = this.device.createShaderModule({ code: fullscreenQuadWGSL + "\n" + fragmentCode });
        return this.device.createRenderPipeline({
            layout: "auto",
            vertex: { module: shaderModule, entryPoint: "vertex_main" },
            fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list" }
        });
    }

    render(commandEncoder, inputView, outputView) {
        // Update GUI
        if (settings.bloomThreshold !== this.settings.threshold || settings.bloomIntensity !== this.settings.intensity) {
            this.settings.threshold = settings.bloomThreshold;
            this.settings.intensity = settings.bloomIntensity;
            this.device.queue.writeBuffer(this.bloomUniforms, 0, new Float32Array([this.settings.threshold, this.settings.intensity]));
        }

        // Pass 1: Threshold: input => rt1
        this._dispatchPass(commandEncoder, this.thresholdPipeline, this.rt1.view, [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: inputView },
            { binding: 2, resource: { buffer: this.bloomUniforms } }
        ]);

        // Pass 2: Blur Horizontal: rt1 => rt2
        this._dispatchPass(commandEncoder, this.blurPipeline, this.rt2.view, [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.rt1.view },
            { binding: 2, resource: { buffer: this.blurUniformsH } }
        ]);

        // Pass 3: Blur Vertical: rt2 => rt1
        this._dispatchPass(commandEncoder, this.blurPipeline, this.rt1.view, [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.rt2.view },
            { binding: 2, resource: { buffer: this.blurUniformsV } }
        ]);

        // Pass 4: Composite: input + rt1 => outputView
        const bindGroupCmp = this.device.createBindGroup({
            layout: this.compositePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: inputView },
                { binding: 2, resource: this.rt1.view },
                { binding: 3, resource: { buffer: this.bloomUniforms } }
            ]
        });
        const passCmp = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: outputView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear", storeOp: "store"
            }]
        });
        passCmp.setPipeline(this.compositePipeline);
        passCmp.setBindGroup(0, bindGroupCmp);
        passCmp.draw(3, 1, 0, 0);
        passCmp.end();
    }

    _dispatchPass(commandEncoder, pipeline, dstView, entries) {
        const bindGroup = this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries
        });
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: dstView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear", storeOp: "store"
            }]
        });
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(3, 1, 0, 0);
        passEncoder.end();
    }
}

// ---------------------------------------------
// Vector Blur Effect (基于亮度梯度的炫光模糊)
// ---------------------------------------------
class VectorBlurEffect {
    constructor(id = "vBlur1") {
        this.id = id;
        this.settings = {
            mapRadius: 5.0,
            amount: 30.0
        };
        // 动态注册至全局 settings
        if (settings[this.id + '_MapRadius'] === undefined) {
            settings[this.id + '_MapRadius'] = this.settings.mapRadius;
        }
        if (settings[this.id + '_Amount'] === undefined) {
            settings[this.id + '_Amount'] = this.settings.amount;
        }
        if (settings[this.id + '_Revolution'] === undefined) {
            settings[this.id + '_Revolution'] = 1.0;
        }
        this.settings.revolution = settings[this.id + '_Revolution'];
    }

    init(device, format, sampler) {
        this.device = device;
        this.format = format;
        this.sampler = sampler;

        this.width = canvas.width;
        this.height = canvas.height;

        this.rt1 = new RenderTarget(device, format);
        this.rt2 = new RenderTarget(device, format);
        this.rt1.resize(this.width, this.height);
        this.rt2.resize(this.width, this.height);

        this._setupUniforms();
        this._setupPipelines();
    }

    resize(width, height) {
        this.width = width;
        this.height = height;
        this.rt1.resize(this.width, this.height);
        this.rt2.resize(this.width, this.height);

        this.device.queue.writeBuffer(this.blurUniformsH, 0, new Float32Array([1.0, 0.0, this.width, this.height, this.settings.mapRadius, 0, 0, 0]));
        this.device.queue.writeBuffer(this.blurUniformsV, 0, new Float32Array([0.0, 1.0, this.width, this.height, this.settings.mapRadius, 0, 0, 0]));
        this.device.queue.writeBuffer(this.licUniforms, 0, new Float32Array([this.settings.amount, this.width, this.height, this.settings.revolution]));
    }

    _setupUniforms() {
        this.blurUniformsH = this.device.createBuffer({
            size: 8 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.blurUniformsV = this.device.createBuffer({
            size: 8 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.licUniforms = this.device.createBuffer({
            size: 4 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.resize(this.width, this.height);
    }

    _setupPipelines() {
        // --- 1. Gaussian Blur Pipeline (for Luminance Smoothing) ---
        const blurWGSL = /* wgsl */`
        @group(0) @binding(0) var srcSampler : sampler;
        @group(0) @binding(1) var srcTexture : texture_2d<f32>;
        
        struct BlurUniforms { 
            dir: vec2<f32>, 
            res: vec2<f32>,
            radius: f32,
            pad1: f32,
            pad2: f32,
            pad3: f32
        }
        @group(0) @binding(2) var<uniform> uniforms : BlurUniforms;

        @fragment
        fn fragment_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
            let offset = uniforms.dir / uniforms.res;
            var color = vec4<f32>(0.0);
            var total_weight = 0.0;
            
            let r = i32(uniforms.radius);
            if (r == 0) {
                return textureSampleLevel(srcTexture, srcSampler, uv, 0.0);
            }
            
            let sigma = max(f32(r) / 2.0, 1.0);
            let two_sigma_sq = 2.0 * sigma * sigma;

            for(var i = -r; i <= r; i++) {
                let x = f32(i);
                let weight = exp(-(x * x) / two_sigma_sq);
                color += textureSampleLevel(srcTexture, srcSampler, uv + offset * x, 0.0) * weight;
                total_weight += weight;
            }
            return color / total_weight;
        }`;

        const shaderModuleBlur = this.device.createShaderModule({ code: fullscreenQuadWGSL + "\n" + blurWGSL });
        this.blurPipeline = this.device.createRenderPipeline({
            layout: "auto",
            vertex: { module: shaderModuleBlur, entryPoint: "vertex_main" },
            fragment: { module: shaderModuleBlur, entryPoint: "fragment_main", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list" }
        });

        // --- 2. LIC Pipeline ---
        const licWGSL = /* wgsl */`
        @group(0) @binding(0) var srcSampler : sampler;
        @group(0) @binding(1) var colorTex : texture_2d<f32>; // 原图 (未经处理的高清输入)
        @group(0) @binding(2) var mapTex : texture_2d<f32>; // 经过高斯模糊的向导图
        
        struct LicUniforms {
            amount: f32,
            res_x: f32,
            res_y: f32,
            revolution: f32
        }
        @group(0) @binding(3) var<uniform> uniforms : LicUniforms;

        fn luminance(color: vec3<f32>) -> f32 {
            return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
        }

        @fragment
        fn fragment_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
            let amount = i32(uniforms.amount);
            if (amount == 0) {
                return textureSampleLevel(colorTex, srcSampler, uv, 0.0);
            }
            
            // Step 1: 从模糊映射图中提取平滑的亮度
            let mapColor = textureSampleLevel(mapTex, srcSampler, uv, 0.0).rgb;
            let lum = luminance(mapColor);
            
            // Step 2: 映射为 0~360度 (0~2PI)，并乘以 Revolution 系数
            let angle = lum * 6.28318530718 * uniforms.revolution;
            let dir = vec2<f32>(cos(angle), sin(angle));
            
            let step_size = vec2<f32>(1.0 / uniforms.res_x, 1.0 / uniforms.res_y);
            let uv_offset_step = dir * step_size;
            
            var composite = vec4<f32>(0.0);
            var total_weight = 0.0;
            
            // 单向正向线性卷积采样
            for(var i = 0; i <= amount; i++) {
                let x = f32(i);
                
                // 线积分衰减：从 0.0 (原点) 到 1.0 (末端) 产生抛物线消散
                let norm = x / f32(amount); 
                let weight = 1.0 - (norm * norm); 
                
                composite += textureSampleLevel(colorTex, srcSampler, uv + uv_offset_step * x, 0.0) * weight;
                total_weight += weight;
            }
            
            return composite / total_weight;
        }`;

        const shaderModuleLic = this.device.createShaderModule({ code: fullscreenQuadWGSL + "\n" + licWGSL });
        this.licPipeline = this.device.createRenderPipeline({
            layout: "auto",
            vertex: { module: shaderModuleLic, entryPoint: "vertex_main" },
            fragment: { module: shaderModuleLic, entryPoint: "fragment_main", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list" }
        });
    }

    render(commandEncoder, inputView, outputView) {
        const guiMapRadius = settings[this.id + '_MapRadius'];
        const guiAmount = settings[this.id + '_Amount'];
        const guiRevolution = settings[this.id + '_Revolution'];

        if (guiMapRadius !== this.settings.mapRadius || guiAmount !== this.settings.amount || guiRevolution !== this.settings.revolution) {
            this.settings.mapRadius = guiMapRadius;
            this.settings.amount = guiAmount;
            this.settings.revolution = guiRevolution;
            
            this.device.queue.writeBuffer(this.blurUniformsH, 0, new Float32Array([1.0, 0.0, this.width, this.height, this.settings.mapRadius, 0, 0, 0]));
            this.device.queue.writeBuffer(this.blurUniformsV, 0, new Float32Array([0.0, 1.0, this.width, this.height, this.settings.mapRadius, 0, 0, 0]));
            this.device.queue.writeBuffer(this.licUniforms, 0, new Float32Array([this.settings.amount, this.width, this.height, this.settings.revolution]));
        }

        // Pass 1: Horizontal Blur on inputView -> rt1
        this._dispatchPass(commandEncoder, this.blurPipeline, this.rt1.view, [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: inputView },
            { binding: 2, resource: { buffer: this.blurUniformsH } }
        ]);

        // Pass 2: Vertical Blur on rt1 -> rt2
        this._dispatchPass(commandEncoder, this.blurPipeline, this.rt2.view, [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.rt1.view },
            { binding: 2, resource: { buffer: this.blurUniformsV } }
        ]);

        // Pass 3: LIC Convolution (inputView + rt2) -> outputView
        this._dispatchPass(commandEncoder, this.licPipeline, outputView, [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: inputView },
            { binding: 2, resource: this.rt2.view },
            { binding: 3, resource: { buffer: this.licUniforms } }
        ]);
    }
    
    _dispatchPass(commandEncoder, pipeline, dstView, entries) {
        const bindGroup = this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries
        });
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: dstView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear", storeOp: "store"
            }]
        });
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(3, 1, 0, 0);
        passEncoder.end();
    }
}
