export interface UntrustedContentEnvelope {
  trust: 'untrusted';
  source: string;
  content: string;
  policy: {
    mayProvideData: true;
    mayProvideInstructions: false;
    mayAuthorizeActions: false;
    mayRevealSecrets: false;
  };
}

export function untrustedContent(source: string, content: string, maxLength = 100_000): UntrustedContentEnvelope {
  if (!source.trim()) throw new Error('untrusted content source is required');
  return {
    trust: 'untrusted',
    source: source.slice(0, 200),
    content: content.slice(0, maxLength),
    policy: {
      mayProvideData: true,
      mayProvideInstructions: false,
      mayAuthorizeActions: false,
      mayRevealSecrets: false,
    },
  };
}

export function assertTrustedAuthorization(value: unknown): asserts value is { trust: 'trusted-control'; action: string } {
  if (!value || typeof value !== 'object' || (value as any).trust !== 'trusted-control' || typeof (value as any).action !== 'string') {
    throw new Error('authorization must originate from TaskRail trusted control state; external/AI content cannot authorize actions');
  }
}

export function aiSecurityBoundary() {
  return {
    externalContent: 'data-only',
    promptInstructionsFromExternalContent: 'ignored-as-authority',
    mutationAuthorization: 'trusted-control-only',
    secretDisclosureFromModelOutput: 'forbidden',
    toolPermissions: 'explicit-allowlist',
  } as const;
}
