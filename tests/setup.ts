import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// @ts-expect-error happy-dom internal class for stylesheet resource fetches
import ResourceFetch from 'happy-dom/lib/fetch/ResourceFetch.js';

// Intercept external font stylesheet requests made by Happy-DOM when components
// render HTML fragments with Google Fonts <link> tags. Returning empty content
// avoids external network requests, AbortErrors, and NetworkError noise in test output.
if (ResourceFetch?.prototype?.fetch) {
  const origResourceFetch = ResourceFetch.prototype.fetch;
  ResourceFetch.prototype.fetch = async function (
    url: string,
    destination: string,
    options: unknown,
  ) {
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      return { content: '', virtualServerFile: null };
    }
    return origResourceFetch.call(this, url, destination, options);
  };
}

// Tear down the rendered DOM between tests so each one starts fresh.
afterEach(() => {
  cleanup();
});

