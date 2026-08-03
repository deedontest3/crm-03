import { createContext, useContext, type ReactNode } from "react";
import type { Deal } from "@/types/deal";

const DealFormDataContext = createContext<Partial<Deal> | null>(null);

export const DealFormDataProvider = ({
  formData,
  children,
}: {
  formData: Partial<Deal>;
  children: ReactNode;
}) => (
  <DealFormDataContext.Provider value={formData}>
    {children}
  </DealFormDataContext.Provider>
);

export const useDealFormData = (): Partial<Deal> | null =>
  useContext(DealFormDataContext);
