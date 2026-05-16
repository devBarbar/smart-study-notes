let id = 0;

export const v4 = () => {
  id += 1;
  return `perf-uuid-${id}`;
};
