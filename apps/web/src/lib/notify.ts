import { dynaura } from 'dynaura';

// Confirmations only: what just happened, in a few words. Errors stay inline next to what they are about, where
// they can be read and acted on. One wrapper so the toast library is a single import to swap or mock.
export const notify = {
  done: (title: string, description?: string) => {
    dynaura.success(description ? { title, description } : { title });
  },
};
