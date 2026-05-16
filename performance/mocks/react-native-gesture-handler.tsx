import React from 'react';

type Handler = (...args: any[]) => unknown;

class TestGesture {
  handlers: Record<string, Handler> = {};

  enabled() {
    return this;
  }

  manualActivation() {
    return this;
  }

  minDistance() {
    return this;
  }

  minPointers() {
    return this;
  }

  maxPointers() {
    return this;
  }

  onTouchesDown(handler: Handler) {
    this.handlers.onTouchesDown = handler;
    return this;
  }

  onBegin(handler: Handler) {
    this.handlers.onBegin = handler;
    return this;
  }

  onUpdate(handler: Handler) {
    this.handlers.onUpdate = handler;
    return this;
  }

  onEnd(handler: Handler) {
    this.handlers.onEnd = handler;
    return this;
  }

  onFinalize(handler: Handler) {
    this.handlers.onFinalize = handler;
    return this;
  }

  runOnJS() {
    return this;
  }
}

const createGesture = () => new TestGesture();

export const Gesture = {
  Hover: createGesture,
  Pan: createGesture,
  Pinch: createGesture,
  Simultaneous: (...gestures: TestGesture[]) => ({ gestures }),
};

export const GestureDetector = ({ children }: { children: React.ReactNode }) =>
  React.createElement('GestureDetector', null, children);

export const PointerType = {
  STYLUS: 'stylus',
};
