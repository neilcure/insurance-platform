export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUppercase: false,
  requireLowercase: false,
  requireNumber: false,
  requireSpecial: false,
};

/**
 * Validate a password against the given policy.
 * Returns an array of human-readable error strings (empty = valid).
 */
export function validatePassword(password: string, policy: PasswordPolicy): string[] {
  const errors: string[] = [];
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Must contain at least one uppercase letter");
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Must contain at least one lowercase letter");
  }
  if (policy.requireNumber && !/\d/.test(password)) {
    errors.push("Must contain at least one number");
  }
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    errors.push("Must contain at least one special character");
  }
  return errors;
}

/** Build a short summary of what the policy requires, for display */
export function policyDescription(policy: PasswordPolicy): string {
  const parts: string[] = [`Min ${policy.minLength} characters`];
  if (policy.requireUppercase) parts.push("uppercase");
  if (policy.requireLowercase) parts.push("lowercase");
  if (policy.requireNumber) parts.push("number");
  if (policy.requireSpecial) parts.push("special character");
  return parts.join(", ");
}
