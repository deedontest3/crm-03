alter table public.yearly_revenue_targets add column if not exists business_unit text;
update public.yearly_revenue_targets set business_unit = 'RT' where business_unit is null;
alter table public.yearly_revenue_targets alter column business_unit set not null;
alter table public.yearly_revenue_targets drop constraint if exists yearly_revenue_targets_bu_chk;
alter table public.yearly_revenue_targets add constraint yearly_revenue_targets_bu_chk check (business_unit in ('EBU','RT','MBU'));
alter table public.yearly_revenue_targets drop constraint if exists yearly_revenue_targets_pkey;
alter table public.yearly_revenue_targets add primary key (year, business_unit);