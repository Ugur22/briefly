import type { BriefPermissions, BriefStatus, WorkspaceRole } from '@briefly/contracts';
import { briefPermissions } from './permissions';

export const isEditableStatus = (status: BriefStatus) => status === 'draft' || status === 'changes_requested';

// What a role may do with a brief in a given status. Mirrors the workflow trigger, which stays the authority
// (it also refuses self-approval, which needs to know who submitted; the web handles that case for display).
export function briefActions(role: WorkspaceRole, status: BriefStatus): BriefPermissions {
  const can = briefPermissions(role);
  const editable = isEditableStatus(status);
  return {
    edit: can.edit && editable,
    delete: can.delete,
    submit: can.edit && editable,
    decide: (role === 'approver' || role === 'admin') && status === 'in_review',
  };
}
