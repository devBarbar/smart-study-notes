import React from 'react';

const svgComponent = (name: string) =>
  React.forwardRef(({ children, ...props }: any, ref) =>
    React.createElement(name, { ...props, ref }, children),
  );

const Svg = svgComponent('Svg');

export default Svg;
export const Circle = svgComponent('SvgCircle');
export const Defs = svgComponent('SvgDefs');
export const Ellipse = svgComponent('SvgEllipse');
export const G = svgComponent('SvgG');
export const Line = svgComponent('SvgLine');
export const Marker = svgComponent('SvgMarker');
export const Path = svgComponent('SvgPath');
export const Polygon = svgComponent('SvgPolygon');
export const Polyline = svgComponent('SvgPolyline');
export const Rect = svgComponent('SvgRect');
export const Text = svgComponent('SvgText');
