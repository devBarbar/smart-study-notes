export type SubmissionGate = {
  isLocked: () => boolean;
  tryEnter: () => boolean;
  leave: () => void;
};

export const createSubmissionGate = (): SubmissionGate => {
  let locked = false;

  return {
    isLocked: () => locked,
    tryEnter: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
    leave: () => {
      locked = false;
    },
  };
};
