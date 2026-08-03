import { supabase } from '@/integrations/supabase/client';

export interface UserLookupMap {
  [key: string]: string; // name/email -> UUID
}

export interface UserResolverResult {
  userMap: UserLookupMap;
  resolveUserName: (name: string, fallbackUserId: string) => string;
}

/**
 * Checks if a string is a valid UUID
 */
export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Builds a user lookup map from auth.users and profiles
 * Returns multiple keys per user for flexible matching:
 * - Full name (e.g., "Shraddha Nandwadekar")
 * - Email (e.g., "shraddha.nandwadekar@realthingks.com")
 * - Email username (e.g., "shraddha.nandwadekar")
 * - Name parts (e.g., "shraddha", "nandwadekar")
 */
export async function buildUserLookupMap(): Promise<UserResolverResult> {
  const userMap: UserLookupMap = {};
  
  try {
    // First, try to get users from the user-admin edge function
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    
    if (token) {
      try {
        const response = await supabase.functions.invoke('user-admin', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        
        if (response.data?.users) {
          console.log('UserNameResolver: Fetched', response.data.users.length, 'users from user-admin');
          
          for (const user of response.data.users) {
            const userId = user.id;
            const email = user.email?.toLowerCase() || '';
            const fullName = user.user_metadata?.full_name || '';
            
            // Add all possible keys for this user
            addUserKeys(userMap, userId, fullName, email);
          }
        }
      } catch (edgeFnError) {
        console.warn('UserNameResolver: Edge function failed, falling back to profiles table:', edgeFnError);
      }
    }
    
    // Also query the profiles table for additional display names
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles_public' as any)
      .select('id, full_name, "Email ID"');
    
    if (!profilesError && profiles) {
      console.log('UserNameResolver: Fetched', profiles.length, 'profiles');
      
      for (const profile of profiles as any[]) {
        const userId = (profile as any).id;
        const fullName = (profile as any).full_name || '';
        const email = (profile as any)['Email ID']?.toLowerCase() || '';
        
        // Add keys (won't overwrite if already exist)
        addUserKeys(userMap, userId, fullName, email);
      }
    }
    
    console.log('UserNameResolver: Built lookup map with', Object.keys(userMap).length, 'keys');
    
  } catch (error) {
    console.error('UserNameResolver: Error building user lookup map:', error);
  }
  
  return {
    userMap,
    resolveUserName: (name: string, fallbackUserId: string) => 
      resolveUserName(userMap, name, fallbackUserId)
  };
}

/**
 * Add multiple lookup keys for a single user
 */
function addUserKeys(
  userMap: UserLookupMap, 
  userId: string, 
  fullName: string, 
  email: string
): void {
  // Skip if userId is not valid
  if (!userId) return;
  
  // Full name (case-insensitive)
  if (fullName) {
    const normalizedName = fullName.toLowerCase().trim();
    if (!userMap[normalizedName]) {
      userMap[normalizedName] = userId;
    }
    
    // Also add without extra spaces
    const cleanName = normalizedName.replace(/\s+/g, ' ');
    if (cleanName !== normalizedName && !userMap[cleanName]) {
      userMap[cleanName] = userId;
    }
  }
  
  // Email (case-insensitive)
  if (email) {
    const normalizedEmail = email.toLowerCase().trim();
    if (!userMap[normalizedEmail]) {
      userMap[normalizedEmail] = userId;
    }
    
    // Email username (before @)
    const emailUsername = normalizedEmail.split('@')[0];
    if (emailUsername && !userMap[emailUsername]) {
      userMap[emailUsername] = userId;
    }
    
    // Email username with dots replaced by spaces (e.g., "peter.jakobsson" -> "peter jakobsson")
    const emailNameFromDots = emailUsername.replace(/\./g, ' ').trim();
    if (emailNameFromDots && !userMap[emailNameFromDots]) {
      userMap[emailNameFromDots] = userId;
    }
  }
}

/**
 * Resolve a name to a UUID using the lookup map
 * Resolution priority:
 * 1. Already a valid UUID - return as-is
 * 2. Exact match (case-insensitive)
 * 3. Partial match (first/last name)
 * 4. Fallback to provided fallback user ID
 */
export function resolveUserName(
  userMap: UserLookupMap, 
  name: string, 
  fallbackUserId: string
): string {
  // Already a valid UUID
  if (isValidUUID(name)) {
    return name;
  }
  
  // Empty or null value
  if (!name || name.trim() === '') {
    return fallbackUserId;
  }
  
  const normalizedName = name.toLowerCase().trim();
  
  // Exact match
  if (userMap[normalizedName]) {
    console.log(`UserNameResolver: Resolved "${name}" to UUID (exact match)`);
    return userMap[normalizedName];
  }
  
  // Try matching with dots replaced by spaces (for email-style names)
  const nameWithDots = normalizedName.replace(/\s+/g, '.');
  if (userMap[nameWithDots]) {
    console.log(`UserNameResolver: Resolved "${name}" to UUID (dot match)`);
    return userMap[nameWithDots];
  }
  
  // Non-deterministic substring matching removed: a CSV owner "Jo Smith"
  // used to assign the record to whichever similarly-named user iterated
  // first. If the name doesn't match a full record exactly (or via the
  // dot-form above), fall back to the caller — leaving the owner unset when
  // there is no fallback is safer than silently picking the wrong person.
  console.log(`UserNameResolver: Could not resolve "${name}" exactly, using fallback user`);
  return fallbackUserId;
}


/**
 * Fields that contain user references (names that need to be converted to UUIDs)
 */
export const USER_REFERENCE_FIELDS = [
  'contact_owner',
  'created_by',
  'modified_by',
  'lead_owner',
  'assigned_to',
  'account_owner'
];

/**
 * Check if a field is a user reference field
 */
export function isUserReferenceField(fieldName: string): boolean {
  return USER_REFERENCE_FIELDS.includes(fieldName.toLowerCase());
}
