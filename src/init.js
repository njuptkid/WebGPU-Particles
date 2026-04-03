function onMouseMove(e) {
    const { width, height } = canvas.getBoundingClientRect()

    if (!mouseInfos.current) mouseInfos.current = []
    mouseInfos.current[0] = e.offsetX / width
    mouseInfos.current[1] = 1 - e.offsetY / height
}

function onWebGPUDetectionError(error) {
    console.log('Could not initialize WebGPU: ' + error)
    document.querySelector('.webgpu-not-supported').style.visibility = 'visible'
    return false
}

async function initContext() {
    if (navigator.gpu == null)
        return onWebGPUDetectionError('WebGPU NOT Supported')

    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return onWebGPUDetectionError('No adapter found')

    device = await adapter.requestDevice()

    canvas = document.getElementById("canvas-container")
    context = canvas.getContext("webgpu");
    if (!context) return onWebGPUDetectionError("Canvas does not support WebGPU")

    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mousedown', (e) => {
        mouseInfos.isPressed = true
        const { width, height } = canvas.getBoundingClientRect()
        if (!mouseInfos.current) mouseInfos.current = []
        mouseInfos.current[0] = e.offsetX / width
        mouseInfos.current[1] = 1 - e.offsetY / height
        if (globalUniforms.particle_spawn_pos) {
            globalUniforms.particle_spawn_pos.needsUpdate = [...mouseInfos.current]
        }
    })
    canvas.addEventListener('mouseup', () => {
        mouseInfos.isPressed = false
    })

    gui = new dat.GUI()

    presentationFormat = navigator.gpu.getPreferredCanvasFormat(adapter)

    context.configure({
        device,
        format: presentationFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        alphaMode: 'opaque'
    })

    initSizes()

    let resizeTimeout
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(refreshSizes, 150)
    })

    return true
}

function refreshSizes() {
    initSizes()
    initBuffers()
    initPrograms()
    if (typeof postProcessChain !== 'undefined') {
        postProcessChain.resize(canvas.width, canvas.height)
    }
    globalUniforms.gridSize.needsUpdate = [settings.grid_w, settings.grid_h, settings.grid_d, settings.dx, settings.rdx, 0, 0, 0]
}


function initSizes() {
    // Fixed 3D grid size
    settings.grid_w = settings.grid_size
    settings.grid_h = settings.grid_size
    settings.grid_d = settings.grid_size

    settings.rdx = settings.grid_size * 4
    settings.dx = 1 / settings.rdx

    // Canvas matches window size for rendering
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
}

const SIMULATION_GRID_SIZES = [32, 64, 128]

function initGUI() {
    gui.add(settings, 'pressure_iterations', 0, 50).name("Pressure Iterations")

    gui.add(settings, 'grid_size', SIMULATION_GRID_SIZES).name("Grid Size").onChange(refreshSizes)

    gui.add(settings, 'reset').name("Clear")
}
