import React from 'react';

export const GlassContainer = ({ children, ...props }: any) =>
  React.createElement('GlassContainer', props, children);

export const GlassView = ({ children, ...props }: any) =>
  React.createElement('GlassView', props, children);

export const isGlassEffectAPIAvailable = () => false;
export const isLiquidGlassAvailable = () => false;
