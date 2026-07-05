/**
 * Route-presence gating for the sidebar: rows whose pages aren't in this
 * build (enterprise pages are carved out of open-core) must not render, and
 * call sites that don't pass `routes` must keep today's full sidebar.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './Sidebar';

const base = { workspaceName: 'W', currentPath: '/app/content' };

describe('Sidebar route gating', () => {
  it('drops rows for routes absent from the build', () => {
    const html = renderToStaticMarkup(
      <Sidebar {...base} routes={{ graph: false, meetings: false, admin: false }} isAdmin />,
    );
    expect(html).not.toContain('href="/app/graph"');
    expect(html).not.toContain('href="/app/meetings"');
    expect(html).not.toContain('href="/app/admin"');
    // Rows whose pages exist stay put.
    expect(html).toContain('href="/app/requests"');
    expect(html).toContain('href="/app/content"');
  });

  it('renders everything when routes are present', () => {
    const html = renderToStaticMarkup(
      <Sidebar {...base} routes={{ graph: true, meetings: true, admin: true }} isAdmin />,
    );
    expect(html).toContain('href="/app/graph"');
    expect(html).toContain('href="/app/meetings"');
    expect(html).toContain('href="/app/admin"');
  });

  it('defaults to visible when the prop is omitted (existing call sites)', () => {
    const html = renderToStaticMarkup(<Sidebar {...base} />);
    expect(html).toContain('href="/app/graph"');
    expect(html).toContain('href="/app/meetings"');
  });
});
