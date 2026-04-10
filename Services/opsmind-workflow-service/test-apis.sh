#!/bin/bash

# OpsMind Workflow Service - API Test Script
# This script demonstrates all workflow APIs with test data

BASE_URL="http://localhost:3003"
HEADER="Content-Type: application/json"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  OpsMind Workflow Service - API Test Suite          ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to make API calls
call_api() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "${YELLOW}→ ${description}${NC}"
    echo -e "  ${method} ${endpoint}"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}${endpoint}" -H "${HEADER}")
    else
        response=$(curl -s -w "\n%{http_code}" -X ${method} "${BASE_URL}${endpoint}" \
            -H "${HEADER}" \
            -d "${data}")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ Success (${http_code})${NC}"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
    else
        echo -e "${RED}✗ Failed (${http_code})${NC}"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
    fi
    echo ""
    sleep 0.5
}

# ═══════════════════════════════════════════════════════
# 1. Health Check
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 1. Health Check ═══${NC}"
call_api "GET" "/health" "" "Check service health and database connection"

# ═══════════════════════════════════════════════════════
# 2. Setup Support Groups
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 2. Setup Support Groups ═══${NC}"

call_api "POST" "/admin/groups" '{
  "name": "Building-A Floor-1 Support",
  "building": "A",
  "floor": 1,
  "parentGroupId": null
}' "Create Building A Floor 1 Support Group"

call_api "POST" "/admin/groups" '{
  "name": "Building-A Floor-2 Support",
  "building": "A",
  "floor": 2,
  "parentGroupId": null
}' "Create Building A Floor 2 Support Group"

call_api "POST" "/admin/groups" '{
  "name": "Building-B Floor-1 Support",
  "building": "B",
  "floor": 1,
  "parentGroupId": null
}' "Create Building B Floor 1 Support Group"

call_api "POST" "/admin/groups" '{
  "name": "Building-B Floor-3 Support",
  "building": "B",
  "floor": 3,
  "parentGroupId": null
}' "Create Building B Floor 3 Support Group"

call_api "POST" "/admin/groups" '{
  "name": "IT Supervisors - Building A",
  "building": "A",
  "floor": 0,
  "parentGroupId": null
}' "Create Supervisory Group"

# ═══════════════════════════════════════════════════════
# 3. Add Group Members
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 3. Add Group Members ═══${NC}"

call_api "POST" "/admin/members" '{
  "userId": 10,
  "groupId": 1,
  "role": "JUNIOR",
  "canAssign": false,
  "canEscalate": false
}' "Add Junior Technician Alice (userId: 10) to Group 1"

call_api "POST" "/admin/members" '{
  "userId": 11,
  "groupId": 1,
  "role": "JUNIOR",
  "canAssign": false,
  "canEscalate": false
}' "Add Junior Technician Bob (userId: 11) to Group 1"

call_api "POST" "/admin/members" '{
  "userId": 20,
  "groupId": 1,
  "role": "SENIOR",
  "canAssign": true,
  "canEscalate": true
}' "Add Senior Technician Emily (userId: 20) to Group 1"

call_api "POST" "/admin/members" '{
  "userId": 12,
  "groupId": 2,
  "role": "JUNIOR",
  "canAssign": false,
  "canEscalate": false
}' "Add Junior Technician Carol (userId: 12) to Group 2"

call_api "POST" "/admin/members" '{
  "userId": 21,
  "groupId": 2,
  "role": "SENIOR",
  "canAssign": true,
  "canEscalate": true
}' "Add Senior Technician Frank (userId: 21) to Group 2"

call_api "POST" "/admin/members" '{
  "userId": 13,
  "groupId": 3,
  "role": "JUNIOR",
  "canAssign": false,
  "canEscalate": false
}' "Add Junior Technician David (userId: 13) to Group 3"

call_api "POST" "/admin/members" '{
  "userId": 22,
  "groupId": 3,
  "role": "SENIOR",
  "canAssign": true,
  "canEscalate": true
}' "Add Senior Technician Grace (userId: 22) to Group 3"

call_api "POST" "/admin/members" '{
  "userId": 30,
  "groupId": 5,
  "role": "SENIOR",
  "canAssign": true,
  "canEscalate": true
}' "Add Supervisor Henry (userId: 30) to Supervisory Group"

# ═══════════════════════════════════════════════════════
# 4. Setup Escalation Rules
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 4. Setup Escalation Rules ═══${NC}"

call_api "POST" "/admin/escalation-rules" '{
  "sourceGroupId": 1,
  "targetGroupId": 5,
  "triggerType": "SLA",
  "delayMinutes": 30,
  "priority": 1
}' "Create SLA Escalation Rule (Group 1 → Group 5, 30 min)"

call_api "POST" "/admin/escalation-rules" '{
  "sourceGroupId": 1,
  "targetGroupId": 2,
  "triggerType": "MANUAL",
  "delayMinutes": 0,
  "priority": 2
}' "Create Manual Escalation Rule (Group 1 → Group 2)"

call_api "POST" "/admin/escalation-rules" '{
  "sourceGroupId": 3,
  "targetGroupId": 5,
  "triggerType": "CRITICAL",
  "delayMinutes": 0,
  "priority": 1
}' "Create Critical Escalation Rule (Group 3 → Group 5)"

call_api "POST" "/admin/escalation-rules" '{
  "sourceGroupId": 1,
  "targetGroupId": 5,
  "triggerType": "REOPEN_COUNT",
  "delayMinutes": 0,
  "priority": 1
}' "Create Reopen Count Escalation Rule"

# ═══════════════════════════════════════════════════════
# 5. Query Operations
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 5. Query Operations ═══${NC}"

call_api "GET" "/admin/groups/building/A" "" "List all groups in Building A"

call_api "GET" "/admin/groups/1" "" "Get details of Group 1"

call_api "GET" "/admin/groups/1/members" "" "List members of Group 1"

call_api "GET" "/admin/members/1" "" "Get details of Member 1"

call_api "GET" "/admin/escalation-rules" "" "List all escalation rules"

# ═══════════════════════════════════════════════════════
# 6. Ticket Routing
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 6. Ticket Routing ═══${NC}"

call_api "POST" "/workflow/route" '{
  "ticketId": 1001,
  "building": "A",
  "floor": 1,
  "priority": "MEDIUM"
}' "Route ticket 1001 to Building A Floor 1"

call_api "POST" "/workflow/route" '{
  "ticketId": 1002,
  "building": "A",
  "floor": 1,
  "priority": "HIGH"
}' "Route ticket 1002 to Building A Floor 1 (HIGH priority)"

call_api "POST" "/workflow/route" '{
  "ticketId": 1003,
  "building": "A",
  "floor": 2,
  "priority": "LOW"
}' "Route ticket 1003 to Building A Floor 2"

call_api "POST" "/workflow/route" '{
  "ticketId": 1004,
  "building": "B",
  "floor": 1,
  "priority": "MEDIUM"
}' "Route ticket 1004 to Building B Floor 1"

call_api "GET" "/workflow/route/1001" "" "Get routing status for ticket 1001"

# ═══════════════════════════════════════════════════════
# 7. Claim Operations
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 7. Claim Operations ═══${NC}"

call_api "GET" "/workflow/group/1/unclaimed" "" "List unclaimed tickets in Group 1"

call_api "POST" "/workflow/claim" '{
  "ticketId": 1001,
  "memberId": 1,
  "userId": 10
}' "Junior tech Alice (member 1) claims ticket 1001"

call_api "POST" "/workflow/claim" '{
  "ticketId": 1002,
  "memberId": 2,
  "userId": 11
}' "Junior tech Bob (member 2) claims ticket 1002"

call_api "GET" "/workflow/claim/1001/status" "" "Check claim status of ticket 1001"

call_api "GET" "/workflow/claim/member/1/tickets" "" "Get all tickets claimed by member 1"

# ═══════════════════════════════════════════════════════
# 8. Reassignment Operations
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 8. Reassignment Operations ═══${NC}"

call_api "POST" "/workflow/reassign" '{
  "ticketId": 1001,
  "fromMemberId": 1,
  "toMemberId": 2,
  "performedBy": 20,
  "reason": "Workload balancing"
}' "Senior Emily reassigns ticket 1001 from Alice to Bob"

call_api "GET" "/workflow/reassign/1001/history" "" "Get reassignment history for ticket 1001"

# ═══════════════════════════════════════════════════════
# 9. Escalation Operations
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 9. Escalation Operations ═══${NC}"

call_api "POST" "/workflow/escalate/manual" '{
  "ticketId": 1002,
  "performedBy": 20,
  "reason": "Requires supervisor review",
  "targetGroupId": 5
}' "Senior Emily manually escalates ticket 1002 to supervisors"

call_api "GET" "/workflow/escalate/1002/history" "" "Get escalation history for ticket 1002"

call_api "GET" "/workflow/escalate/pending" "" "List all pending escalations"

# ═══════════════════════════════════════════════════════
# 10. Member Status Management
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 10. Member Status Management ═══${NC}"

call_api "PATCH" "/admin/members/1/status" '{
  "status": "ON_LEAVE"
}' "Set Alice (member 1) status to ON_LEAVE"

call_api "GET" "/admin/members/1" "" "Verify Alice's status is ON_LEAVE"

call_api "PATCH" "/admin/members/1/status" '{
  "status": "ACTIVE"
}' "Reactivate Alice (member 1)"

# ═══════════════════════════════════════════════════════
# 11. Monitoring Dashboards
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}═══ 11. Monitoring Dashboards ═══${NC}"

call_api "GET" "/workflow/dashboard/group/1/workload" "" "Get workload dashboard for Group 1"

call_api "GET" "/workflow/dashboard/member/1/performance" "" "Get performance dashboard for member 1"

call_api "GET" "/workflow/dashboard/metrics" "" "Get overall workflow metrics"

call_api "GET" "/workflow/dashboard/sla-compliance" "" "Get SLA compliance report"

# ═══════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════
echo -e "${BLUE}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Test Suite Complete!                                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}All API endpoints have been tested.${NC}"
echo -e "View Swagger documentation at: ${BLUE}http://localhost:3003/api-docs${NC}"
echo ""
