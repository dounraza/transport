CREATE DATABASE IF NOT EXISTS coop_taxi_brousse CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE coop_taxi_brousse;

CREATE TABLE IF NOT EXISTS membres (
  id INT AUTO_INCREMENT PRIMARY KEY, nom VARCHAR(120) NOT NULL, telephone VARCHAR(30), role ENUM('Membre','Chauffeur','Administrateur') NOT NULL DEFAULT 'Membre', statut ENUM('Actif','Inactif') NOT NULL DEFAULT 'Actif', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vehicules (
  id INT AUTO_INCREMENT PRIMARY KEY, immatriculation VARCHAR(30) NOT NULL UNIQUE, modele VARCHAR(80) NOT NULL, capacite INT NOT NULL DEFAULT 18, proprietaire_id INT NULL, statut ENUM('Disponible','En course','Maintenance') NOT NULL DEFAULT 'Disponible', FOREIGN KEY (proprietaire_id) REFERENCES membres(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS trajets (
  id INT AUTO_INCREMENT PRIMARY KEY, depart VARCHAR(100) NOT NULL, arrivee VARCHAR(100) NOT NULL, date_trajet DATE NOT NULL, heure TIME NULL, vehicule_id INT NULL, chauffeur_id INT NULL, passagers INT NOT NULL DEFAULT 0, recette DECIMAL(12,2) NOT NULL DEFAULT 0, statut ENUM('Planifié','Terminé','Annulé') NOT NULL DEFAULT 'Planifié', FOREIGN KEY (vehicule_id) REFERENCES vehicules(id) ON DELETE SET NULL, FOREIGN KEY (chauffeur_id) REFERENCES membres(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS mouvements (
  id INT AUTO_INCREMENT PRIMARY KEY, type ENUM('Recette','Dépense') NOT NULL, libelle VARCHAR(160) NOT NULL, montant DECIMAL(12,2) NOT NULL, date_mouvement DATE NOT NULL, trajet_id INT NULL, FOREIGN KEY (trajet_id) REFERENCES trajets(id) ON DELETE SET NULL
);

INSERT INTO membres (nom, telephone, role) VALUES ('Aucun membre exemple', '000 00 00 00', 'Membre');
