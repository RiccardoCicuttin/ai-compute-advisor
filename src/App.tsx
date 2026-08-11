import AdvisorPage from "./pages/AdvisorPage";
import { I18nProvider } from "./i18n";

export default function App() {
  return (
    <I18nProvider>
      <AdvisorPage />
    </I18nProvider>
  );
}
