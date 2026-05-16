import React from 'react';

const hostComponent = (name: string) =>
  React.forwardRef(({ children, ...props }: any, ref) =>
    React.createElement(name, { ...props, ref }, children),
  );

const createFakePath = (commands: string[] = []) => ({
  commands,
  moveTo(x: number, y: number) {
    commands.push(`M${x},${y}`);
    return this;
  },
  lineTo(x: number, y: number) {
    commands.push(`L${x},${y}`);
    return this;
  },
  quadTo(cpx: number, cpy: number, x: number, y: number) {
    commands.push(`Q${cpx},${cpy},${x},${y}`);
    return this;
  },
  setIsVolatile() {
    return this;
  },
  copy() {
    return createFakePath([...commands]);
  },
});

export type SkPath = ReturnType<typeof createFakePath>;

export const Canvas = hostComponent('SkiaCanvas');
export const Fill = hostComponent('SkiaFill');
export const Line = hostComponent('SkiaLine');
export const Path = hostComponent('SkiaPath');

export const Skia = {
  Path: {
    Make: () => createFakePath(),
  },
};

export const useCanvasRef = () =>
  React.useRef({
    makeImageSnapshot: () => ({
      encodeToBase64: () => 'perf-canvas-image',
    }),
  });
