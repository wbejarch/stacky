import { useContext } from 'react';
import { TutorContext, type TutorContextValue } from './TutorContext';

/** Reads the tutor state. Must be called under a `TutorProvider`. */
export function useTutor(): TutorContextValue {
  const value = useContext(TutorContext);
  if (value === null) {
    throw new Error('useTutor must be used within a TutorProvider');
  }
  return value;
}
