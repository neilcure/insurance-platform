/**
 * English (default) message dictionary.
 *
 * Conventions
 * -----------
 * - Group keys by surface: `nav.*`, `common.*`, `auth.*`, `dashboard.*`, etc.
 * - Use camelCase leaves: `nav.dashboard`, `common.save`.
 * - Keep the value identical to the literal that already appears in
 *   the JSX so the visible UI does not change when phase 2 starts
 *   wrapping strings with `t(...)`.
 * - Never embed dynamic data — placeholders use `{name}`-style tokens
 *   and are interpolated by `tStatic`.
 *
 * The shape of this object is the source of truth. `messages/zh-HK.ts`
 * (and any future locale) must mirror its structure; missing leaves
 * fall back to the value here.
 */

/**
 * Type of every dictionary tree. We intentionally type the object
 * BEFORE assigning literals so that:
 *   - leaves stay `string` (other locales can hold any string value)
 *   - the SHAPE is enforced (other locales can't invent new keys)
 *
 * Adding a new section here is a breaking change — the matching
 * locale files become responsible for filling it in (or accepting
 * the English fallback at runtime).
 */
export type Messages = {
  nav: {
    dashboard: string;
    overview: string;
    policies: string;
    clients: string;
    agents: string;
    accounting: string;
    documents: string;
    admin: string;
    settings: string;
    logout: string;
    platform: string;
    imports: string;
    membership: string;
    profile: string;
    docs: string;
    guide: string;
    myPolicies: string;
    myProfile: string;
  };
  sidebar: {
    adminPanel: string;
    policySettings: string;
    packages: string;
    userSettings: string;
    activityLog: string;
    clientNumberSettings: string;
    landingPage: string;
    paymentSchedules: string;
    systemDiagnostics: string;
    accountingRules: string;
    flows: string;
    documentTemplates: string;
    workflowActions: string;
    policyStatuses: string;
    uploadDocuments: string;
    backendDocuments: string;
    pdfMailMerge: string;
    category: string;
    fields: string;
    clientAccount: string;
    account: string;
    switchTeam: string;
    /** "{label} — Category" — placeholder for the package's name. */
    categoryHint: string;
    /** "{label} — Fields" — placeholder for the package's name. */
    fieldsHint: string;
  };
  common: {
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    close: string;
    confirm: string;
    /** Plain "OK" button used by `alertDialog`. */
    ok: string;
    back: string;
    next: string;
    create: string;
    update: string;
    search: string;
    loading: string;
    noResults: string;
    yes: string;
    no: string;
    optional: string;
    required: string;
    /** Fallback display label when neither name nor email is available. */
    fallbackUserName: string;
  };
  auth: {
    signInTitle: string;
    signOut: string;
    email: string;
    password: string;
    forgotPassword: string;
    rememberMe: string;
    /** Sign-in page strings. */
    signin: {
      welcomeBack: string;
      subtitle: string;
      signingIn: string;
      continueWithGoogle: string;
      or: string;
      contactAdmin: string;
      loading: string;
      errorGoogleAccessDenied: string;
      errorIdleTimeout: string;
      errorGoogleFailed: string;
      errorNoResponse: string;
      errorInvalidCredentials: string;
      errorSignInFailed: string;
      /** "Sign in error: {error}" — `{error}` is a server message. */
      errorGeneric: string;
    };
    /** Forgot-password page strings. */
    forgot: {
      title: string;
      description: string;
      checkEmail: string;
      sendLink: string;
      sentMessage: string;
      tryAnother: string;
      backToSignIn: string;
      toastSuccess: string;
      toastError: string;
      devOnly: string;
      copy: string;
      invalidEmail: string;
    };
    /** Reset-password page strings. */
    reset: {
      title: string;
      newPassword: string;
      confirmPassword: string;
      placeholderRetype: string;
      passwordsNoMatch: string;
      fillAll: string;
      updating: string;
      updatePassword: string;
      /** "At least {n} characters" — `{n}` is the policy.minLength number. */
      minLength: string;
      uppercase: string;
      lowercase: string;
      number: string;
      special: string;
      failedReset: string;
      success: string;
    };
    /** Invite-acceptance page strings. */
    invite: {
      title: string;
      passwordHint: string;
      confirmPassword: string;
      passwordMinLen: string;
      passwordsNoMatch: string;
      failedAccept: string;
      invalidExpired: string;
      success: string;
      submitting: string;
      setPassword: string;
    };
  };
  /** Strings used by the dashboard policies table chrome. */
  policiesTable: {
    /** Implicit "Insured" group label that's auto-injected when the API doesn't return a `packages` row for it. */
    implicitInsured: string;
  };
  /** Wizard "Insured" step (`InsuredStep.tsx`) chrome — labels that are NOT admin-configurable. */
  insured: {
    /** Section heading above the insured-type radio group. */
    typeLabel: string;
    /** Help text shown when no insured categories are configured in admin. */
    noCategoriesHelp: string;
    /** Section heading above the per-insured-type field grid. */
    infoSectionTitle: string;
    /** Empty state shown inside a multi-select that has no options. */
    noOptionsConfigured: string;
  };
  /** Public landing-page chrome (everything OUTSIDE the admin-edited content). */
  landing: {
    signIn: string;
    forgotPassword: string;
    allRightsReserved: string;
  };
  /** Dashboard page strings (page header, primary action, welcome card). */
  dashboard: {
    title: string;
    createPolicy: string;
    welcomeTitle: string;
    welcomeSignedInAs: string;
    welcomeRole: string;
    welcomeAccountSetupComplete: string;
    /** Fallback when the role field is missing from the session payload. */
    welcomeFallbackRole: string;
  };
  /** Policy-renewal calendar widget on the dashboard. */
  calendar: {
    title: string;
    error: {
      failedToLoad: string;
    };
    bucket: {
      outstanding: string;
      pending: string;
      rejected: string;
      overdue: string;
      inProgress: string;
      thisWeek: string;
      thisMonth: string;
      later: string;
    };
    day: {
      today: string;
      tomorrow: string;
      yesterday: string;
    };
    action: {
      open: string;
      email: string;
      openTitle: string;
      emailReminder: string;
    };
    starts: {
      today: string;
      tomorrow: string;
    };
    toolbar: {
      clearFilters: string;
      calendarSettings: string;
      unsavedChanges: string;
      noChanges: string;
      showByMonth: string;
      /** "Show all {count}" — `{count}` is the total row count. */
      showAllCount: string;
    };
    aria: {
      openDayPreview: string;
    };
  };
  /** Top-level strings used by `app/(dashboard)/dashboard/accounting/page.tsx`. */
  accounting: {
    /** Toolbar button that toggles the column / display panel. */
    display: string;
  };
  /** Strings used by static admin landing pages (route `page.tsx` files). */
  admin: {
    policySettings: {
      title: string;
      description: string;
      availableSettings: string;
      vehicleCategory: string;
      vehicleFields: string;
      uploadDocumentTypes: string;
    };
    users: {
      subtitle: string;
      description: string;
    };
  };
  locale: {
    label: string;
    en: string;
    "zh-HK": string;
  };
};

const messages: Messages = {
  nav: {
    dashboard: "Dashboard",
    overview: "Overview",
    policies: "Policies",
    clients: "Clients",
    agents: "Agents",
    accounting: "Accounting",
    documents: "Documents",
    admin: "Admin",
    settings: "Settings",
    logout: "Sign out",
    platform: "Platform",
    imports: "Imports",
    membership: "Membership",
    profile: "Profile",
    docs: "Docs",
    guide: "Guide",
    myPolicies: "My Policies",
    myProfile: "My Profile",
  },

  sidebar: {
    adminPanel: "Admin Panel",
    policySettings: "Policy Settings",
    packages: "Packages",
    userSettings: "User Settings",
    activityLog: "Activity Log",
    clientNumberSettings: "Client Number Settings",
    landingPage: "Landing Page",
    paymentSchedules: "Payment Schedules",
    systemDiagnostics: "System Diagnostics",
    accountingRules: "Accounting Rules",
    flows: "Flows",
    documentTemplates: "Document Templates",
    workflowActions: "Workflow Actions",
    policyStatuses: "Policy Statuses",
    uploadDocuments: "Upload Documents",
    backendDocuments: "Backend Documents",
    pdfMailMerge: "PDF Mail Merge",
    category: "Category",
    fields: "Fields",
    clientAccount: "Client account",
    account: "Account",
    switchTeam: "Switch team",
    categoryHint: "{label} — Category",
    fieldsHint: "{label} — Fields",
  },

  common: {
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    close: "Close",
    confirm: "Confirm",
    ok: "OK",
    back: "Back",
    next: "Next",
    create: "Create",
    update: "Update",
    search: "Search",
    loading: "Loading…",
    noResults: "No results",
    yes: "Yes",
    no: "No",
    optional: "Optional",
    required: "Required",
    fallbackUserName: "User",
  },

  auth: {
    signInTitle: "Sign in",
    signOut: "Sign out",
    email: "Email",
    password: "Password",
    forgotPassword: "Forgot password?",
    rememberMe: "Remember me",
    signin: {
      welcomeBack: "Welcome back",
      subtitle: "Sign in to your account to continue",
      signingIn: "Signing in...",
      continueWithGoogle: "Continue with Google",
      or: "or",
      contactAdmin: "Don't have an account? Contact your administrator.",
      loading: "Loading...",
      errorGoogleAccessDenied: "Google sign-in is only available for invited, active users. Please ask an admin to invite your email.",
      errorIdleTimeout: "You were signed out automatically due to inactivity. Please sign in again.",
      errorGoogleFailed: "Google sign-in failed. Please try again.",
      errorNoResponse: "No response from auth server.",
      errorInvalidCredentials: "Invalid email or password.",
      errorSignInFailed: "Sign in failed. Please try again.",
      errorGeneric: "Sign in error: {error}",
    },
    forgot: {
      title: "Reset your password",
      description: "Enter your email and we'll send you a link to reset your password.",
      checkEmail: "Check your email for a reset link.",
      sendLink: "Send reset link",
      sentMessage: "If an account with that email exists, you'll receive a password reset link shortly.",
      tryAnother: "Try another email",
      backToSignIn: "Back to sign in",
      toastSuccess: "If an account exists, a reset link was sent.",
      toastError: "Request failed",
      devOnly: "Dev only - Reset link:",
      copy: "Copy",
      invalidEmail: "Enter a valid email",
    },
    reset: {
      title: "Reset Password",
      newPassword: "New Password",
      confirmPassword: "Confirm Password",
      placeholderRetype: "Re-enter your password",
      passwordsNoMatch: "Passwords do not match",
      fillAll: "Please fill in all fields",
      updating: "Updating...",
      updatePassword: "Update Password",
      minLength: "At least {n} characters",
      uppercase: "Uppercase letter (A-Z)",
      lowercase: "Lowercase letter (a-z)",
      number: "Number (0-9)",
      special: "Special character (!@#...)",
      failedReset: "Failed to reset password",
      success: "Password updated. You can now log in.",
    },
    invite: {
      title: "Accept Invite",
      passwordHint: "Password (min 10 chars)",
      confirmPassword: "Confirm Password",
      passwordMinLen: "Password must be at least 10 characters",
      passwordsNoMatch: "Passwords do not match",
      failedAccept: "Failed to accept invite",
      invalidExpired: "Invalid or expired invite",
      success: "Password set. You can now log in.",
      submitting: "Submitting...",
      setPassword: "Set Password",
    },
  },

  policiesTable: {
    implicitInsured: "Insured",
  },

  insured: {
    typeLabel: "Insured Type",
    noCategoriesHelp:
      "No insured categories configured. Please create one in Admin → Policy Settings → Insured Category.",
    infoSectionTitle: "Insured Info",
    noOptionsConfigured: "No options configured.",
  },

  landing: {
    signIn: "Sign in",
    forgotPassword: "Forgot password",
    allRightsReserved: "All rights reserved.",
  },

  dashboard: {
    title: "Dashboard",
    createPolicy: "Create Policy",
    welcomeTitle: "Welcome",
    welcomeSignedInAs: "Signed in as",
    welcomeRole: "Role",
    welcomeAccountSetupComplete: "Account setup complete",
    welcomeFallbackRole: "user",
  },

  calendar: {
    title: "Policy Calendar",
    error: {
      failedToLoad: "Failed to load",
    },
    bucket: {
      outstanding: "Outstanding",
      pending: "Pending",
      rejected: "Rejected",
      overdue: "Overdue",
      inProgress: "In Progress",
      thisWeek: "This week",
      thisMonth: "This month",
      later: "Later",
    },
    day: {
      today: "Today",
      tomorrow: "Tomorrow",
      yesterday: "Yesterday",
    },
    action: {
      open: "Open",
      email: "Email",
      openTitle: "Open policy",
      emailReminder: "Email a renewal reminder",
    },
    starts: {
      today: "Starts today",
      tomorrow: "Starts tomorrow",
    },
    toolbar: {
      clearFilters: "Clear all status filters",
      calendarSettings: "Calendar settings",
      unsavedChanges: "Unsaved changes",
      noChanges: "No changes",
      showByMonth: "Show by month",
      showAllCount: "Show all {count}",
    },
    aria: {
      openDayPreview: "Open document tasks and day preview",
    },
  },

  accounting: {
    display: "Display",
  },

  admin: {
    policySettings: {
      title: "Policy Settings",
      description: "Configure policy-related options.",
      availableSettings: "Available Settings",
      vehicleCategory: "Vehicle Category",
      vehicleFields: "Vehicle Fields",
      uploadDocumentTypes: "Upload Document Types",
    },
    users: {
      subtitle: "Manage users and permissions.",
      description:
        "Invite users, change roles, activate/deactivate or delete accounts.",
    },
  },

  locale: {
    label: "Language",
    en: "English",
    "zh-HK": "繁體中文",
  },
};

export default messages;
