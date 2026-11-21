export type EvaluationRole = 'admin' | 'buyer' | 'cedis' | 'provider';

export interface PortalAuthUser {
  id: string;
  subject: string;
  name: string;
  email: string;
  role: EvaluationRole;
  supplierId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: PortalAuthUser;
    }
  }
}
