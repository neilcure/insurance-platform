"use client";

import * as React from "react";

export type DrawerTab = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  permanent?: boolean;
  content: React.ReactNode;
};

export type DrawerTabsContextValue = {
  activeTab: string;
  setActiveTab: (id: string) => void;
  tabs: DrawerTab[];
};

const DrawerTabsContext = React.createContext<DrawerTabsContextValue | null>(null);

export function useDrawerTabs() {
  return React.useContext(DrawerTabsContext);
}

/**
 * Provider that holds tab state. Wrap around both
 * <DrawerTabContent /> and <DrawerTabStrip />.
 */
export function DrawerTabsProvider({
  tabs,
  defaultTab,
  children,
}: {
  tabs: DrawerTab[];
  defaultTab?: string;
  children: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = React.useState(
    defaultTab ?? tabs[0]?.id ?? "",
  );

  const value = React.useMemo(
    () => ({ activeTab, setActiveTab, tabs }),
    [activeTab, tabs],
  );

  return (
    <DrawerTabsContext.Provider value={value}>
      {children}
    </DrawerTabsContext.Provider>
  );
}

/** Renders the active tab's content. */
export function DrawerTabContent() {
  const ctx = useDrawerTabs();
  if (!ctx || ctx.tabs.length === 0) return null;
  const active = ctx.tabs.find((t) => t.id === ctx.activeTab) ?? ctx.tabs[0];
  return <>{active.content}</>;
}

/** Vertical tab buttons — meant to be placed outside the drawer edge. */
export function DrawerTabStrip() {
  const ctx = useDrawerTabs();
  if (!ctx || ctx.tabs.length === 0) return null;

  return (
    <>
      {ctx.tabs.map((tab, idx) => {
        const isActive = ctx.activeTab === tab.id;
        const isFirst = idx === 0;
        const isLast = idx === ctx.tabs.length - 1;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => ctx.setActiveTab(tab.id)}
            className={`flex w-10 flex-col items-center gap-1.5 px-1.5 py-3.5 transition-all duration-300 ease-out border-r border-neutral-200 dark:border-neutral-800 ${
              !isLast ? "border-b" : ""
            } ${isFirst ? "border-t rounded-tr-lg" : ""} ${isLast ? "border-b rounded-br-lg" : ""} ${
              isActive
                ? "bg-yellow-400 text-neutral-900 dark:bg-yellow-400 dark:text-neutral-900"
                : "bg-yellow-100 text-neutral-900 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-white dark:hover:bg-yellow-800/40"
            }`}
            title={tab.label}
          >
            {/* Key includes active state to force re-mount and replay animation */}
            <span
              key={isActive ? `${tab.id}-active` : tab.id}
              className={`whitespace-nowrap text-[11px] leading-none transition-all duration-300 ${
                isActive
                  ? "font-semibold tracking-wide"
                  : "font-medium tracking-wide opacity-75 hover:opacity-100"
              }`}
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                animation: isActive ? "tab-text-in 0.35s ease-out" : "none",
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </>
  );
}
