/// <reference types="vite/client" />

interface Window {
  Telegram?: {
    WebApp: {
      initData: string;
      colorScheme: "light" | "dark";
      ready(): void;
      expand(): void;
      setHeaderColor(color: string): void;
      setBackgroundColor(color: string): void;
      HapticFeedback?: {
        impactOccurred(style: "light" | "medium" | "heavy"): void;
      };
    };
  };
}
