# WebGPU 3D 流体模拟项目简介

这是一个基于 **WebGPU** 的 **3D 流体模拟**项目。
该项目是作者为了学习 WebGPU API 而建立的一个实验性游乐场，旨在利用 JavaScript 和 WebGPU 实现 Jos Stam 的经典论文《Real-Time Fluid Dynamics for Games》（游戏中的实时流体动力学）。与传统的 OpenGL/WebGL 使用片段着色器计算不同，该项目利用了 WebGPU 的**计算着色器 (Compute Shaders)** 来专门处理流体力学中密集的并行计算。

## 项目核心结构

项目主要由前端网页和原生 JavaScript 源代码模块组成：

1. **入口文件**：
   * `index.html`: 包含用于渲染的 Canvas 元素以及一段用于检测浏览器是否支持 WebGPU 的代码。它按顺序加载了所有的核心脚本和第三方库（如 `dat.gui`）。

2. **核心源码 (`src/` 目录)**：
   * `main.js`: 模拟的主入口，包含了核心的渲染循环（Render Loop）以及流体模拟逻辑的设定。
   * `init.js`: 负责初始化工作，如获取 WebGPU 上下文、设定画布尺寸以及初始化 GUI 交互面板。
   * `shaders.js`: 包含了极其重要的 **WGSL** (WebGPU Shading Language) 字符串文件，这里编写了所有计算流体动力学的计算着色器代码。
   * `utils.js`: 实用工具模块，封装了用于处理 WebGPU 缓冲区 (Buffers)、Uniforms 参数传递以及着色器程序创建的帮助函数。
   * `render.js`: （基于2D的前序遗留脚本）。
   * `particleRender.js`: 专用于粒子的 3D 渲染和透视投影的具体实现模块。

3. **依赖/资源文件**：
   * `libraries/`: 存放了第三方库 `dat.gui.min.js`，用于渲染 GUI 参数面板。
   * `assets/`: 存放项目演示动图。

## 运行与环境要求

由于项目依赖 WebGPU，这是一个非常前沿的 Web API。要运行这个项目，需要现代浏览器（如较新的 Chrome），并且可能还需要在浏览器特殊设置（如 `chrome://flags`）中确保未禁用 WebGPU 功能。
