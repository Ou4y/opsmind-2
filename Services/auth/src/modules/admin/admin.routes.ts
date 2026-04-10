import { Router } from 'express';
import { adminController } from './admin.controller';
import {
  createUserValidation,
  createTechnicianValidation,
  updateUserStatusValidation,
  createBuildingValidation,
  deleteUserValidation,
} from './admin.validation';
import { authMiddleware } from '@middlewares/auth.middleware';
import { roleMiddleware } from '@middlewares/role.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin management endpoints (requires ADMIN role)
 */

// All admin routes require authentication and ADMIN role
router.use(authMiddleware);
router.use(roleMiddleware(['ADMIN']));

/**
 * @swagger
 * /admin/users:
 *   post:
 *     summary: Create a new user with any role
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@miuegypt.edu.eg
 *                 description: User's email address
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: SecurePass123!
 *                 description: Must contain uppercase, lowercase, number, and special character
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 example: Ahmed
 *                 description: User's first name
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 example: Hassan
 *                 description: User's last name
 *               role:
 *                 type: string
 *                 enum: [ADMIN, TECHNICIAN, DOCTOR, STUDENT]
 *                 example: DOCTOR
 *                 description: User role to assign
 *               isVerified:
 *                 type: boolean
 *                 default: true
 *                 example: true
 *                 description: Whether user's email is verified (defaults to true for admin-created users)
 *               isActive:
 *                 type: boolean
 *                 default: true
 *                 example: true
 *                 description: Whether user account is active (defaults to true)
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User created successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     email:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     isVerified:
 *                       type: boolean
 *                     isActive:
 *                       type: boolean
 *                     roles:
 *                       type: array
 *                       items:
 *                         type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Validation error or user already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: User with this email already exists
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       403:
 *         description: Forbidden - Admin role required
 *   get:
 *     summary: Get all users
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
// POST /admin/users - Create a new user with any role
router.post(
  '/users',
  createUserValidation,
  adminController.createUser.bind(adminController)
);

// GET /admin/users - Get all users
router.get(
  '/users',
  adminController.getAllUsers.bind(adminController)
);

/**
 * @swagger
 * /admin/technicians:
 *   post:
 *     summary: Create a new technician user
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: tech@miuegypt.edu.eg
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: TechPass123!
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 example: Ahmed
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 example: Hassan
 *               employeeId:
 *                 type: string
 *                 maxLength: 50
 *                 example: EMP001
 *                 description: Optional employee identification number
 *               department:
 *                 type: string
 *                 maxLength: 100
 *                 example: IT Support
 *                 description: Optional department assignment
 *               specialization:
 *                 type: string
 *                 maxLength: 255
 *                 example: Network Infrastructure
 *                 description: Optional technical specialization
 *               buildingIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 example: ["550e8400-e29b-41d4-a716-446655440000"]
 *                 description: Optional array of building IDs to assign (first one becomes primary)
 *     responses:
 *       201:
 *         description: Technician created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Technician created successfully
 *                 technician:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     userId:
 *                       type: string
 *                       format: uuid
 *                     email:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     employeeId:
 *                       type: string
 *                     department:
 *                       type: string
 *                     specialization:
 *                       type: string
 *                     buildings:
 *                       type: array
 *                       items:
 *                         type: object
 *                     isActive:
 *                       type: boolean
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Validation error or duplicate employee ID
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 *   get:
 *     summary: Get all technicians
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all technicians
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
// POST /admin/technicians - Create a new technician
router.post(
  '/technicians',
  createTechnicianValidation,
  adminController.createTechnician.bind(adminController)
);

// GET /admin/technicians - Get all technicians
router.get(
  '/technicians',
  adminController.getAllTechnicians.bind(adminController)
);

/**
 * @swagger
 * /admin/users/{id}/status:
 *   patch:
 *     summary: Update user active status
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isActive
 *             properties:
 *               isActive:
 *                 type: boolean
 *                 example: true
 *                 description: Set to true to activate user, false to deactivate
 *     responses:
 *       200:
 *         description: User status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User status updated successfully
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error or cannot deactivate admin
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 *       404:
 *         description: User not found
 */
// PATCH /admin/users/:id/status - Update user active status
router.patch(
  '/users/:id/status',
  updateUserStatusValidation,
  adminController.updateUserStatus.bind(adminController)
);

/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     summary: Delete a user by ID
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID to delete
 *     responses:
 *       200:
 *         description: User deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User deleted successfully
 *       400:
 *         description: Cannot delete admin users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Cannot delete admin users
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *       403:
 *         description: Forbidden - Admin role required
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: User not found
 */
// DELETE /admin/users/:id - Delete a user
router.delete(
  '/users/:id',
  deleteUserValidation,
  adminController.deleteUser.bind(adminController)
);

/**
 * @swagger
 * /admin/buildings:
 *   get:
 *     summary: Get all buildings
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all buildings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Building'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 *   post:
 *     summary: Create a new building
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - code
 *             properties:
 *               name:
 *                 type: string
 *                 example: Medical Building
 *               code:
 *                 type: string
 *                 example: MED
 *               address:
 *                 type: string
 *                 example: South Wing
 *     responses:
 *       201:
 *         description: Building created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
// GET /admin/buildings - Get all buildings
router.get(
  '/buildings',
  adminController.getAllBuildings.bind(adminController)
);

// POST /admin/buildings - Create a new building
router.post(
  '/buildings',
  createBuildingValidation,
  adminController.createBuilding.bind(adminController)
);

export default router;
