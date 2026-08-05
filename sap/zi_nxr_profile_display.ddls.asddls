@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MyProfile Display Interface'
@Metadata.ignorePropagatedAnnotations: true
define view entity ZI_NXR_PROFILE_DISPLAY
  as select from pa0105 as email
    inner join pa0001 as emp
      on  emp.pernr = email.pernr
      and emp.begda <= $session.system_date
      and emp.endda >= $session.system_date
    left outer join pa0002 as personal
      on  personal.pernr = emp.pernr
      and personal.begda <= $session.system_date
      and personal.endda >= $session.system_date
    left outer join pa0006 as permanent_address
      on  permanent_address.pernr = emp.pernr
      and permanent_address.subty = '1'
      and permanent_address.begda <= $session.system_date
      and permanent_address.endda >= $session.system_date
    left outer join pa0006 as current_address
      on  current_address.pernr = emp.pernr
      and current_address.subty = '2'
      and current_address.begda <= $session.system_date
      and current_address.endda >= $session.system_date
    left outer join pa0009 as bank
      on  bank.pernr = emp.pernr
      and bank.begda <= $session.system_date
      and bank.endda >= $session.system_date
    left outer join pa0185 as identity
      on  identity.pernr = emp.pernr
      and identity.begda <= $session.system_date
      and identity.endda >= $session.system_date
    left outer join bnka as bank_master
      on  bank_master.banks = bank.banks
      and bank_master.bankl = bank.bankl
    left outer join hrp1000 as position_text
      on  position_text.otype = 'S'
      and position_text.objid = emp.plans
      and position_text.plvar = '01'
      and position_text.langu = $session.system_language
      and position_text.endda = '99991231'
    left outer join hrp1000 as org_text
      on  org_text.otype = 'O'
      and org_text.objid = emp.orgeh
      and org_text.plvar = '01'
      and org_text.langu = $session.system_language
      and org_text.endda = '99991231'
{
  key cast( email.usrid_long as abap.char(255) ) as UserId,
      emp.pernr                                     as Pernr,
      emp.ename                                     as EmployeeName,
      cast( personal.gbdat as abap.char(8) )        as DateOfBirth,
      case personal.gesch
        when '1' then cast( 'Male' as abap.char(20) )
        when '2' then cast( 'Female' as abap.char(20) )
        else cast( personal.gesch as abap.char(20) )
      end                                           as Gender,
      cast( personal.natio as abap.char(60) )       as Nationality,
      case personal.famst
        when '0' then cast( 'Single' as abap.char(60) )
        when '1' then cast( 'Married' as abap.char(60) )
        when '2' then cast( 'Widowed' as abap.char(60) )
        when '3' then cast( 'Divorced' as abap.char(60) )
        else cast( personal.famst as abap.char(60) )
      end                                           as MaritalStatus,
      emp.plans                                     as PositionId,
      position_text.stext                           as PositionName,
      emp.orgeh                                     as OrgUnitId,
      org_text.stext                                as OrgUnitName,
      substring( identity.icnum, 1, 20 )             as IdNumber,
      cast( coalesce( current_address.telnr, permanent_address.telnr ) as abap.char(30) ) as Telephone,
      permanent_address.stras                        as PermanentAddress,
      email.usrid_long                               as WorkEmail,
      current_address.stras                          as CurrentAddress,
      cast( '' as abap.char(10) )                   as TaxCode,
      bank.zlsch                                     as PayMethod,
      case bank.zlsch
        when 'C' then cast( 'Cash' as abap.char(60) )
        when 'T' then cast( 'Bank Transfer' as abap.char(60) )
        else cast( bank.zlsch as abap.char(60) )
      end                                           as PayMethodText,
      substring( bank.banks, 1, 3 )                  as BankCountry,
      substring( bank.bankl, 1, 15 )                 as BankKey,
      bank.bankn                                     as BankAccount,
      bank_master.banka                              as BankName,
      cast( emp.begda as abap.char(8) )             as JoinDate,
      cast( emp.persk as abap.char(60) )            as ContractType,
      cast( '' as abap.char(255) )                  as DependentsSummary,
      ' '                                            as IsManager
}
where email.subty = '0010'
  and email.begda <= $session.system_date
  and email.endda >= $session.system_date
