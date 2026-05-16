import React, { useImperativeHandle } from 'react';
import { View } from 'react-native';

const ViewShot = React.forwardRef(({ children, ...props }: any, ref) => {
  useImperativeHandle(ref, () => ({
    capture: async () => '/tmp/perf-view-shot.png',
  }));

  return <View {...props}>{children}</View>;
});

export default ViewShot;
