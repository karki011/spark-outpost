import { expect, type Locator } from '@playwright/test';

export async function expandSection(screen: Locator, name: string): Promise<void> {
  const toggle = screen.getByRole('button', { name: new RegExp(`^${name}`) });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await screen.page().mouse.move(0, 0);
}
