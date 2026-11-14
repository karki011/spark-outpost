import type { ComponentPropsWithRef } from 'react';

type Tone = 'soft' | 'primary' | 'line' | 'ghost';

type ButtonProps = Omit<ComponentPropsWithRef<'button'>, 'type'> & {
  tone: Tone;
  small?: boolean;
};

export function Button({ tone, small = false, className, ...rest }: ButtonProps) {
  const classes = ['btn', tone, small ? 'sm' : null, className].filter(Boolean).join(' ');
  return <button type="button" className={classes} {...rest} />;
}
