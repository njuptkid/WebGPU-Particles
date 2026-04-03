let settings = {
    grid_size: 128,
    grid_w: 64,
    grid_h: 64,
    grid_d: 64,
    sim_speed: 5,
    contain_fluid: true,
    velocity_add_intensity: 0.2,
    velocity_add_radius: 0.0005,
    velocity_diffusion: 0.9999,
    viscosity: 0.8,
    vorticity: 2,
    pressure_iterations: 20,

    particle_radius: 0.06,
    particle_max_life: 20.0,
    particle_render_size: 0.02,
    particle_speed: 0.01,
}

let gui
let device, presentationFormat, canvas, context
let postProcessChain


const mouseInfos = {
    current: null,
    last: null,
    velocity: null,
    isPressed: false,
    wasPressed: false
}

// Buffers
let velocity, velocity0, divergence, divergence0, pressure, pressure0, vorticity
let particles, particles0, particleLife, particleColor

// Uniforms
const globalUniforms = {}
let time, dt, mouse, grid, uSimSpeed, vel_force, vel_radius, vel_diff
let viscosity, uVorticity, containFluid
let particleSpawnPos, particleRadius, particleMaxLife, particleSeed, particleRenderSize, particleSpeed

// Programs
let velocityInjectProgram, advectProgram, boundaryProgram, divergenceProgram
let boundaryDivProgram, pressureProgram, boundaryPressureProgram, gradientSubtractProgram
let clearPressureProgram, vorticityProgram, vorticityConfinementProgram
let particleInitProgram, particleUpdateProgram, particleRenderProgram

function initBuffers() {
    velocity = new DynamicBuffer({ components: 3 })
    velocity0 = new DynamicBuffer({ components: 3 })

    divergence = new DynamicBuffer()
    divergence0 = new DynamicBuffer()

    pressure = new DynamicBuffer()
    pressure0 = new DynamicBuffer()

    vorticity = new DynamicBuffer({ components: 3 })

    particles = new DynamicBuffer({ components: 3, w: 100, h: 300, d: 1 })
    particles0 = new DynamicBuffer({ components: 3, w: 100, h: 300, d: 1 })
    particleLife = new DynamicBuffer({ w: 100, h: 300, d: 1 })
    particleColor = new DynamicBuffer({ components: 3, w: 100, h: 300, d: 1 })
}

function initUniforms() {
    time = new Uniform('time')
    dt = new Uniform('dt')
    mouse = new Uniform('mouseInfos', { size: 4 })
    grid = new Uniform('gridSize', { size: 8, value: [settings.grid_w, settings.grid_h, settings.grid_d, settings.dx, settings.rdx, 0, 0, 0] })
    uSimSpeed = new Uniform('sim_speed', { min: 0.1, max: 20, addToGUI: false })
    vel_force = new Uniform('velocity_add_intensity', { displayName: "Velocity Force", min: 0, max: .5 })
    vel_radius = new Uniform('velocity_add_radius', { displayName: "Velocity Radius", min: 0, max: 0.01, step: 0.00001 })
    vel_diff = new Uniform('velocity_diffusion', { displayName: "Velocity Diffusion", min: 0.95, max: 1, step: 0.00001 })
    viscosity = new Uniform('viscosity', { displayName: "Viscosity", min: 0, max: 1 })
    uVorticity = new Uniform('vorticity', { displayName: "Vorticity", min: 0, max: 10, step: 0.00001 })
    containFluid = new Uniform('contain_fluid', { displayName: "Solid boundaries" })

    particleSpawnPos = new Uniform('particle_spawn_pos', { size: 2, value: [0.5, 0.5] })
    particleRadius = new Uniform('particle_radius', { min: 0.01, max: 0.2 })
    particleMaxLife = new Uniform('particle_max_life', { min: 1, max: 20 })
    particleSeed = new Uniform('particle_seed', { addToGUI: false })
    particleRenderSize = new Uniform('particle_render_size', { displayName: "Particle Size", min: 0.001, max: 0.05, step: 0.001 })
    particleSpeed = new Uniform('particle_speed', { displayName: "Particle Speed", min: 0.01, max: 2.0, step: 0.01 })
}

function initPrograms() {
    velocityInjectProgram = new Program({
        buffers: [velocity, velocity0],
        uniforms: [grid, mouse, vel_force, vel_radius, vel_diff, dt],
        shader: velocityInjectShader,
    })

    advectProgram = new Program({
        buffers: [velocity0, velocity],
        uniforms: [grid, dt],
        shader: advectShader,
    })

    boundaryProgram = new Program({
        buffers: [velocity, velocity0],
        uniforms: [grid, containFluid],
        shader: boundaryShader,
    })

    divergenceProgram = new Program({
        buffers: [velocity0, divergence0],
        uniforms: [grid],
        shader: divergenceShader,
    })

    boundaryDivProgram = new Program({
        buffers: [divergence0, divergence],
        uniforms: [grid],
        shader: boundaryPressureShader,
    })

    pressureProgram = new Program({
        buffers: [pressure, divergence, pressure0],
        uniforms: [grid],
        shader: pressureShader,
    })

    boundaryPressureProgram = new Program({
        buffers: [pressure0, pressure],
        uniforms: [grid],
        shader: boundaryPressureShader,
    })

    gradientSubtractProgram = new Program({
        buffers: [pressure, velocity0, velocity],
        uniforms: [grid],
        shader: gradientSubtractShader,
    })

    clearPressureProgram = new Program({
        buffers: [pressure, pressure0],
        uniforms: [grid, viscosity],
        shader: clearPressureShader,
    })

    vorticityProgram = new Program({
        buffers: [velocity, vorticity],
        uniforms: [grid],
        shader: vorticityShader,
    })

    vorticityConfinementProgram = new Program({
        buffers: [velocity, vorticity, velocity0],
        uniforms: [grid, dt, uVorticity],
        shader: vorticityConfinementShader,
    })

    particleInitProgram = new Program({
        buffers: [particles, particleLife, particleColor],
        uniforms: [particleSpawnPos, particleRadius, particleMaxLife, particleSeed],
        shader: particleInitShader,
        dispatchX: 100,
        dispatchY: 300,
        dispatchZ: 1,
    })

    particleUpdateProgram = new Program({
        buffers: [particles, particles0, particleLife, velocity],
        uniforms: [grid, dt, particleSpeed],
        shader: particleUpdateShader,
        dispatchX: 100,
        dispatchY: 300,
        dispatchZ: 1,
    })

    particleRenderProgram = new ParticleRenderProgram()
}

async function main() {
    const initializationSuccess = await initContext()
    if (!initializationSuccess) return

    initBuffers()
    initUniforms()
    initPrograms()

    postProcessChain = new PostProcessChain(device, presentationFormat)
    postProcessChain.addEffect(new BloomEffect())
    postProcessChain.addEffect(new VectorBlurEffect('vBlur1'))
    postProcessChain.addEffect(new VectorBlurEffect('vBlur2'))



    function reset() {
        velocity.clear(device.queue)
        pressure.clear(device.queue)
        particleLife.clear(device.queue)
        settings.time = 0
        loop = 0
    }
    settings.reset = reset

    function dispatchComputePipeline(passEncoder) {
        velocityInjectProgram.dispatch(passEncoder)

        advectProgram.dispatch(passEncoder)
        boundaryProgram.dispatch(passEncoder)

        divergenceProgram.dispatch(passEncoder)
        boundaryDivProgram.dispatch(passEncoder)

        for (let i = 0; i < settings.pressure_iterations; i++) {
            pressureProgram.dispatch(passEncoder)
            boundaryPressureProgram.dispatch(passEncoder)
        }

        gradientSubtractProgram.dispatch(passEncoder)
        clearPressureProgram.dispatch(passEncoder)

        vorticityProgram.dispatch(passEncoder)
        vorticityConfinementProgram.dispatch(passEncoder)

        if (mouseInfos.isPressed && !mouseInfos.wasPressed) {
            particleSeed.setValue(Math.random() * 1000)
            particleSpawnPos.update(device.queue)
            particleSeed.update(device.queue)
            particleInitProgram.dispatch(passEncoder)
        }

        particleUpdateProgram.dispatch(passEncoder)

        mouseInfos.wasPressed = mouseInfos.isPressed
    }

    let loop = 0
    let lastFrame = performance.now()

    async function step() {
        requestAnimationFrame(step)

        const now = performance.now()
        settings.dt = Math.min(1 / 60, (now - lastFrame) / 1000) * settings.sim_speed
        settings.time += settings.dt
        lastFrame = now

        Object.values(globalUniforms).forEach(u => u.update(device.queue))

        if (mouseInfos.current) {
            mouseInfos.velocity = mouseInfos.last
                ? [mouseInfos.current[0] - mouseInfos.last[0], mouseInfos.current[1] - mouseInfos.last[1]]
                : [0, 0]
            mouse.update(device.queue, [...mouseInfos.current, ...mouseInfos.velocity])
            mouseInfos.last = [...mouseInfos.current]
        }

        const commandEncoder = device.createCommandEncoder()
        const passEncoder = commandEncoder.beginComputePass()
        dispatchComputePipeline(passEncoder)
        passEncoder.end()

        velocity0.copyTo(velocity, commandEncoder)
        pressure0.copyTo(pressure, commandEncoder)
        particles0.copyTo(particles, commandEncoder)

        particleRenderProgram.dispatch(commandEncoder, postProcessChain.mainRT.view)

        postProcessChain.render(commandEncoder, context.getCurrentTexture().createView())

        const gpuCommands = commandEncoder.finish()
        device.queue.submit([gpuCommands])
    }


    initGUI()

    let postFolder = gui.addFolder('Post Processing')

    let bloomFolder = postFolder.addFolder('1. Bloom')
    bloomFolder.add(settings, 'bloomThreshold', 0.0, 2.0).name("Threshold")
    bloomFolder.add(settings, 'bloomIntensity', 0.0, 5.0).name("Intensity")
    bloomFolder.open()

    let blurAFolder = postFolder.addFolder('2. Vector Blur A (Detail)')
    blurAFolder.add(settings, 'vBlur1_MapRadius', 0.0, 20.0).step(1).name("Map Blur Radius")
    blurAFolder.add(settings, 'vBlur1_Amount', 0.0, 100.0).step(1).name("LIC Amount")
    blurAFolder.add(settings, 'vBlur1_Revolution', 0.0, 5.0).step(0.1).name("Revolution")
    blurAFolder.open()

    let blurBFolder = postFolder.addFolder('3. Vector Blur B (Macro)')
    blurBFolder.add(settings, 'vBlur2_MapRadius', 0.0, 50.0).step(1).name("Map Blur Radius")
    blurBFolder.add(settings, 'vBlur2_Amount', 0.0, 100.0).step(1).name("LIC Amount")
    blurBFolder.add(settings, 'vBlur2_Revolution', 0.0, 5.0).step(0.1).name("Revolution")
    blurBFolder.open()

    postFolder.open()
    step()
}

main()
