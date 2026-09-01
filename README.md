# miiwish

Miiwish is a private wishlist app for sharing gift ideas without the usual chaos of duplicate presents.

## How it works for a user

1. A guest opens the wishlist.
2. They enter their name to request access.
3. The request appears in the admin area and waits for approval.
4. Once approved, the guest can see the items and reserve one.
5. Reserved items are marked so nobody else picks the same gift.
6. If the item is released again, it can be reserved by someone else.

## How it works for the admin

1. The admin opens the secret admin login.
2. They sign in with their Firebase Auth account.
3. They can approve or deny access requests.
4. They can add new wishlist items manually or by pasting a product URL.
5. The app extracts title, image, description and price when possible.
6. They can remove items or toggle the reserved state.

## Main flow

- Visitors can request access to the private wishlist.
- The admin decides whether they may view it.
- Approved users can browse the items and reserve them.
- The app keeps the list private and social without exposing the admin password in the frontend.

## Project status

This project is a lightweight static web app with Firebase for auth and data storage.
The frontend is intentionally simple and designed to be hosted as a static site while the real access control is handled by Firebase Authentication and Firestore rules.

## Important security note

The admin login is not checked by a hardcoded password in the browser. Authentication is handled by Firebase Auth, and write access is protected by Firestore rules. The public frontend should never contain sensitive admin credentials.
