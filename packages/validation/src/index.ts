import{z}from'zod';
const strong=z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/);
export const ownerSchema=z.object({shopName:z.string().trim().min(1),fullName:z.string().trim().min(2),username:z.string().trim().min(3),email:z.string().email().optional().or(z.literal('')),password:strong,barcodePrefix:z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/)});
export const loginSchema=z.object({login:z.string().trim().min(1),password:z.string().min(1)});
export const changePasswordSchema=z.object({currentPassword:z.string().min(1),newPassword:strong});
export const paginationSchema=z.object({page:z.coerce.number().int().positive().default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)});
export const dateRangeSchema=z.object({start:z.string().date(),end:z.string().date()}).refine(x=>x.end>=x.start,{message:'La date de fin doit suivre la date de début'});
